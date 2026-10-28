// Состояние плеера без доступа к внутренностям приложения:
//  • метаданные трека — через перехват navigator.mediaSession.metadata;
//  • позиция — через <audio>, пойманный на HTMLMediaElement.prototype.play, плюс setPositionState как запасной вариант;
//  • перемотка и пауза — через обработчики mediaSession, которые регистрирует само приложение.
// Скрипт мода подключается первым в <head>, поэтому хуки встают раньше кода приложения.

const DRIFT_LIMIT = 2.5;

export function createPlayerBridge() {
  const listeners = new Set();
  const handlers = {};
  const audios = new Set();
  let active = null;
  let meta = null;
  let metaSig = '';
  let posState = null; // { position, duration, at, rate }
  let playing = false;
  let metaAt = 0; // когда сменился трек — длительность <audio> до этого момента принадлежит старому
  let prevDuration = 0; // длительность прошлого трека — чтобы распознать её «эхо» после смены

  const ms = navigator.mediaSession;
  const MSProto = window.MediaSession?.prototype;

  // --- metadata
  const desc = MSProto && Object.getOwnPropertyDescriptor(MSProto, 'metadata');
  if (desc?.set) {
    Object.defineProperty(MSProto, 'metadata', {
      configurable: true,
      enumerable: desc.enumerable,
      get() {
        return desc.get.call(this);
      },
      set(v) {
        desc.set.call(this, v);
        queueMicrotask(readMeta);
      },
    });
  }
  setInterval(readMeta, 1000);

  function readMeta() {
    const m = ms?.metadata;
    if (!m || !m.title) return;
    const artwork = [...(m.artwork || [])].sort((a, b) => parseInt(b.sizes) - parseInt(a.sizes))[0]?.src || '';
    const sig = `${m.title}\u0000${m.artist}\u0000${m.album}`;
    if (sig === metaSig) {
      if (meta && artwork && !meta.artwork) meta.artwork = bigCover(artwork);
      return;
    }
    metaSig = sig;
    metaAt = performance.now();
    prevDuration = meta?.duration || posState?.duration || 0;
    posState = null;
    meta = { title: m.title, artist: m.artist || '', album: m.album || '', artwork: bigCover(artwork), duration: 0 };
    for (const fn of listeners) fn(meta);
  }

  // --- position
  if (MSProto?.setPositionState) {
    const orig = MSProto.setPositionState;
    MSProto.setPositionState = function (state) {
      // сразу после смены трека приложение может прислать прогресс ещё от прошлого — пропускаем его
      const echo = state?.duration && prevDuration && performance.now() - metaAt < 1500 && Math.abs(state.duration - prevDuration) < 0.5;
      if (state && Number.isFinite(state.position) && !echo) {
        posState = { position: state.position, duration: state.duration, at: performance.now(), rate: state.playbackRate ?? 1 };
        if (meta && state.duration) meta.duration = state.duration;
      }
      return orig.apply(this, arguments);
    };
  }
  if (MSProto?.setActionHandler) {
    const orig = MSProto.setActionHandler;
    MSProto.setActionHandler = function (action, handler) {
      handlers[action] = handler;
      return orig.apply(this, arguments);
    };
  }
  if (MSProto) {
    const d = Object.getOwnPropertyDescriptor(MSProto, 'playbackState');
    if (d?.set) {
      Object.defineProperty(MSProto, 'playbackState', {
        configurable: true,
        get() {
          return d.get.call(this);
        },
        set(v) {
          playing = v === 'playing';
          if (posState) posState = { ...posState, position: estimateFromState(), at: performance.now() };
          d.set.call(this, v);
        },
      });
    }
  }

  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    track(this);
    return origPlay.apply(this, arguments);
  };

  function track(el) {
    if (audios.has(el)) return;
    audios.add(el);
    el.addEventListener('playing', () => {
      active = el;
    });
    el.addEventListener('emptied', () => {
      if (active === el) active = null;
    });
    el.addEventListener('durationchange', () => {
      el.__ylDurAt = performance.now();
    });
  }

  function estimateFromState() {
    if (!posState) return 0;
    const dt = playing ? ((performance.now() - posState.at) / 1000) * (posState.rate || 1) : 0;
    return posState.position + dt;
  }

  function audioUsable() {
    return active && !Number.isNaN(active.currentTime) && active.readyState > 0;
  }

  return {
    get meta() {
      return meta;
    },
    activeAudio: () => active,
    onTrack(fn) {
      listeners.add(fn);
      if (meta) fn(meta);
      return () => listeners.delete(fn);
    },
    position() {
      const fromState = posState ? estimateFromState() : null;
      if (audioUsable()) {
        const t = active.currentTime;
        // если <audio> явно не совпадает с позицией приложения (например, другой элемент) — верим приложению
        if (fromState == null || Math.abs(t - fromState) < DRIFT_LIMIT || performance.now() - posState.at > 3000) return t;
      }
      return fromState ?? 0;
    },
    duration() {
      if (meta?.duration) return meta.duration;
      if (posState?.duration) return posState.duration;
      // сразу после смены трека <audio> ещё держит предыдущий — его длительность брать нельзя
      const fresh = audioUsable() && ((active.__ylDurAt || 0) > metaAt - 300 || performance.now() - metaAt > 2500);
      if (fresh && Number.isFinite(active.duration) && active.duration > 0) return active.duration;
      return 0;
    },
    isPlaying() {
      if (audioUsable()) return !active.paused;
      return playing;
    },
    seek(t) {
      try {
        handlers.seekto?.({ action: 'seekto', seekTime: t, fastSeek: false });
      } catch (e) {
        console.warn('[ym-lyrics] seekto handler failed', e);
      }
      // обработчик приложения есть не всегда и может проигнорировать вызов — тогда двигаем <audio> сами
      const el = active;
      const check = () => {
        if (el && el === active && Math.abs(el.currentTime - t) > 1.5) el.currentTime = t;
      };
      if (handlers.seekto) setTimeout(check, 300);
      else check();
      if (posState) posState = { ...posState, position: t, at: performance.now() };
    },
    next() {
      handlers.nexttrack?.({ action: 'nexttrack' });
    },
    prev() {
      handlers.previoustrack?.({ action: 'previoustrack' });
    },
    // лайк/дизлайк — через кнопки в плеере самого приложения; null — кнопки нет (не авторизован, подкаст и т.п.)
    likeState: () => pressed('LIKE_BUTTON'),
    dislikeState: () => pressed('DISLIKE_BUTTON'),
    // нажатие делаем горячей клавишей приложения: она всегда относится к текущему треку,
    // а кнопка в DOM бывает скрытой копией, которая ждёт своей анимации и игнорирует click()
    toggleLike: () => appHotkey('KeyF', 'f'),
    toggleDislike: () => appHotkey('KeyD', 'd'),
    togglePlay() {
      const h = this.isPlaying() ? handlers.pause : handlers.play;
      if (h) h({ action: this.isPlaying() ? 'pause' : 'play' });
    },
  };
}

// кнопка плеера приложения: нижняя панель, плеер «Моей волны» или полноэкранный плеер
const PLAYERS = ['PLAYERBAR_DESKTOP', 'VIBE_PLAYERBAR', 'FULLSCREEN_PLAYER'];
function appButton(id) {
  for (const p of PLAYERS) {
    const b = document.querySelector(`[data-test-id="${p}"] [data-test-id="${id}"]`);
    if (b) return b;
  }
  return null;
}

// состояние лайка из кнопки приложения; undefined — кнопку не нашли (горячая клавиша всё равно сработает)
function pressed(id) {
  const b = appButton(id);
  return b ? b.getAttribute('aria-pressed') === 'true' : undefined;
}

// горячая клавиша приложения; помечаем событие, чтобы обработчик мода его не перехватил
export function appHotkey(code, key) {
  const target = document.body || document.documentElement;
  for (const type of ['keydown', 'keyup']) {
    const ev = new KeyboardEvent(type, { code, key, bubbles: true, cancelable: true, composed: true });
    ev.__ylSynthetic = true;
    target.dispatchEvent(ev);
  }
  return true;
}

// обложки Яндекса: .../400x400 → .../800x800 (обложка на экране ~450px — больше не нужно, а память в 1.5 раза меньше)
function bigCover(url) {
  return url ? url.replace(/\/\d+x\d+(?=$|\?)/, '/800x800') : '';
}
