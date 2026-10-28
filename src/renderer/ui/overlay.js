// Полноэкранный режим текста: отрисовка строк, анимация слов, пружинный скролл, настройки.

import { buildTimeline, findActive } from '../word-timing.js';
import { parseLrc } from '../lrc-parser.js';
import { STYLES, VISUALIZERS, LAYOUTS, ALIGNS, WEIGHTS, PARTICLES, FPS, ACCENTS, FONTS } from '../settings.js';
import { createBackground } from './background.js';
import { createVisualizer } from './visualizer.js';

const ICON = {
  lyrics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h11M4 11h8M4 16h6"/><path d="M17 18.5a2.5 2.5 0 1 1-2.5-2.5H17V6l4-1.5"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h2v14H6zM20 5.5v13a.5.5 0 0 1-.77.42L9.5 12.4a.5.5 0 0 1 0-.8l9.73-6.52a.5.5 0 0 1 .77.42z"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 5h2v14h-2zM4 5.5v13a.5.5 0 0 0 .77.42l9.73-6.52a.5.5 0 0 0 0-.8L4.77 5.08A.5.5 0 0 0 4 5.5z"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.8v14.4a.8.8 0 0 0 1.22.68l11.5-7.2a.8.8 0 0 0 0-1.36L8.22 4.12A.8.8 0 0 0 7 4.8z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1.2"/><rect x="14" y="4.5" width="4" height="15" rx="1.2"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21M8 10.5h5"/></svg>',
  reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/></svg>',
  expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  shrink: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 20.3s-7.8-4.6-7.8-10.4A4.4 4.4 0 0 1 12 7.2a4.4 4.4 0 0 1 7.8 2.7c0 5.8-7.8 10.4-7.8 10.4z"/></svg>',
  heartOn: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 20.3s-7.8-4.6-7.8-10.4A4.4 4.4 0 0 1 12 7.2a4.4 4.4 0 0 1 7.8 2.7c0 5.8-7.8 10.4-7.8 10.4z"/></svg>',
  dislike: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M6 18 18 6"/></svg>',
  minimize: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 17h12"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
};

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

export function createOverlay({ player, settings, tap, onRetry }) {
  const root = el('div', 'yl-root');
  let viz = null;
  let fab = null;
  let palette = null;
  const bg = createBackground(root, {
    onPalette: (p) => {
      palette = p;
      applyAccent();
    },
  });

  // свой цвет акцента поверх палитры обложки
  function applyAccent() {
    if (!palette) return;
    const custom = ACCENTS.find((a) => a.id === settings.get().accent && a.c);
    const p = custom ? { ...palette, accent: custom.c[0], accent2: custom.c[1], glow: `${custom.c[0]}88` } : palette;
    root.style.setProperty('--yl-accent', p.accent);
    root.style.setProperty('--yl-accent2', p.accent2);
    root.style.setProperty('--yl-glow', p.glow);
    viz?.setPalette(p);
    fab?.style.setProperty('--yl-fab-accent', p.accent);
  }
  viz = createVisualizer(root, { tap, player, settings });

  // большая обложка сбоку, вокруг неё рисуется кольцо спектра
  const side = el('div', 'yl-side');
  const sideCover = el('div', 'yl-side-cover');
  const sideGlow = el('div', 'yl-side-glow');
  sideCover.append(sideGlow);
  const sideTitle = el('div', 'yl-side-title');
  const sideArtist = el('div', 'yl-side-artist');
  side.append(sideCover, sideTitle, sideArtist);

  const head = el('div', 'yl-head');
  const cover = el('div', 'yl-cover');
  const meta = el('div', 'yl-meta');
  const title = el('div', 'yl-title');
  const artist = el('div', 'yl-artist');
  meta.append(title, artist);
  const minBtn = el('button', 'yl-btn yl-min', ICON.minimize);
  minBtn.title = 'Свернуть окно';
  minBtn.setAttribute('aria-label', 'Свернуть окно');
  const fsBtn = el('button', 'yl-btn', ICON.expand);
  fsBtn.title = 'Во весь экран (F)';
  fsBtn.setAttribute('aria-label', 'Во весь экран');
  const gearBtn = el('button', 'yl-btn', ICON.gear);
  gearBtn.title = 'Настройки';
  gearBtn.setAttribute('aria-label', 'Настройки');
  const closeBtn = el('button', 'yl-btn', ICON.close);
  closeBtn.title = 'Закрыть (Esc)';
  closeBtn.setAttribute('aria-label', 'Закрыть');
  head.append(cover, meta, minBtn, fsBtn, gearBtn, closeBtn);

  const stage = el('div', 'yl-stage');
  const linesBox = el('div', 'yl-lines');
  stage.append(linesBox);

  const status = el('div', 'yl-status');
  const foot = el('div', 'yl-foot');
  const sourceLabel = el('span', 'yl-source');
  const curTime = el('span', 'yl-time');
  const progress = el('div', 'yl-progress', '<u></u><i></i><b></b><span class="yl-tip"></span>');
  const [progressHover, progressBar, progressKnob, progressTip] = progress.children;
  const durTime = el('span', 'yl-time');
  const controls = el('div', 'yl-controls');
  const likeBtn = el('button', 'yl-ctl yl-like', ICON.heart + '<i></i>'.repeat(6));
  likeBtn.title = 'Нравится';
  [...likeBtn.querySelectorAll('i')].forEach((d, i) => d.style.setProperty('--a', `${i * 60}deg`));
  const prevBtn = el('button', 'yl-ctl', ICON.prev);
  prevBtn.title = 'Предыдущий';
  const playBtn = el('button', 'yl-ctl yl-ctl-main', ICON.pause);
  playBtn.title = 'Пауза / играть (пробел)';
  const nextBtn = el('button', 'yl-ctl', ICON.next);
  nextBtn.title = 'Следующий';
  const dislikeBtn = el('button', 'yl-ctl yl-dislike is-hidden', ICON.dislike);
  dislikeBtn.title = 'Не нравится';
  controls.append(likeBtn, prevBtn, playBtn, nextBtn, dislikeBtn);
  for (const b of [likeBtn, prevBtn, playBtn, nextBtn, dislikeBtn]) b.setAttribute('aria-label', b.title);
  const bar = el('div', 'yl-bar');
  bar.append(curTime, progress, durTime);
  const dock = el('div', 'yl-dock');
  dock.append(bar, controls);
  foot.append(dock, sourceLabel);
  prevBtn.onclick = () => player.prev();
  nextBtn.onclick = () => player.next();
  playBtn.onclick = () => player.togglePlay();
  // лайк ставит сама Яндекс Музыка (её кнопка в плеере) — так он сохраняется в аккаунт как обычно
  let liked = false;
  let disliked = null;
  function showLike(on, pop) {
    if (on === undefined || on === liked) return; // состояние неизвестно — оставляем как есть
    liked = on;
    likeBtn.classList.toggle('is-hidden', on == null);
    likeBtn.classList.toggle('is-on', !!on);
    likeBtn.firstChild.outerHTML = on ? ICON.heartOn : ICON.heart;
    likeBtn.setAttribute('aria-pressed', String(!!on));
    if (pop && on) {
      likeBtn.classList.remove('is-pop');
      void likeBtn.offsetWidth;
      likeBtn.classList.add('is-pop');
    }
  }
  function showDislike(on) {
    if (on === undefined || on === disliked) return;
    disliked = on;
    dislikeBtn.classList.toggle('is-hidden', on == null);
    dislikeBtn.classList.toggle('is-on', !!on);
    dislikeBtn.setAttribute('aria-pressed', String(!!on));
  }
  likeBtn.addEventListener('animationend', (e) => e.target === likeBtn.firstChild && likeBtn.classList.remove('is-pop'));
  likeBtn.onclick = () => {
    if (player.toggleLike()) showLike(!liked, true);
  };
  dislikeBtn.onclick = () => {
    if (player.toggleDislike()) showDislike(!disliked);
  };
  let nextLikeCheck = 0;

  // полоса: клик, перетаскивание, подсказка времени под курсором
  let dragFrac = null;
  const fracAt = (x) => {
    const r = progress.getBoundingClientRect();
    return clamp01((x - r.left) / r.width);
  };
  progress.addEventListener('pointermove', (e) => {
    const f = fracAt(e.clientX);
    progressHover.style.transform = `scaleX(${f})`;
    progressTip.style.left = `${f * 100}%`;
    progressTip.textContent = fmt(f * player.duration());
    if (dragFrac != null) dragFrac = f;
  });
  progress.addEventListener('pointerdown', (e) => {
    if (!player.duration()) return;
    progress.setPointerCapture(e.pointerId);
    progress.classList.add('is-drag');
    dragFrac = fracAt(e.clientX);
  });
  const endDrag = (e) => {
    if (dragFrac == null) return;
    const d = player.duration();
    if (d && e.type === 'pointerup') player.seek(dragFrac * d);
    dragFrac = null;
    progress.classList.remove('is-drag');
  };
  progress.addEventListener('pointerup', endDrag);
  progress.addEventListener('pointercancel', endDrag);
  let shownPlaying = null;

  const panel = buildPanel();
  root.append(side, stage, head, status, foot, panel.el);

  fab = el('button', 'yl-fab', `${ICON.lyrics}<span>Текст</span><i class="yl-badge"></i>`);
  fab.title = 'Текст песни (L)';

  document.body.append(root, fab);
  // React приложения может пересобрать <body> и выкинуть чужие элементы — возвращаем оверлей на место
  setInterval(() => {
    if (!root.isConnected) document.body.append(root);
    if (!fab.isConnected) document.body.append(fab);
  }, 1000);

  viz.setFxTargets({ foot, bg: bg.el, glow: bg.glow, sideCover, sideGlow, stage, cover, ctl: playBtn, active: () => items[activeIdx]?.el });

  // ---------- состояние ----------
  let open = false;
  let timeline = null;
  let items = []; // [{data, el, words:[el], dots:[el]}]
  let activeIdx = -2;
  let targetY = 0;
  let y = 0;
  let userOffset = 0;
  let lastWheel = 0;
  let lastFrame = performance.now();
  let needMeasure = true;
  let enterTimer = 0;
  let noLyrics = false;
  let lastDraw = 0;
  let shownY = '';

  applySettings(settings.get());
  settings.onChange(applySettings);

  function applySettings(s) {
    // широкие шрифты (пиксельный Press Start) уменьшаем, чтобы строка помещалась
    const font = FONTS.find((f) => f.id === s.font) || FONTS[0];
    root.style.setProperty('--yl-size', `${Math.round(s.fontSize * (font.scale || 1))}px`);
    root.classList.remove(...STYLES.map((x) => `st-${x.id}`));
    root.classList.add(`st-${s.style}`);
    root.classList.toggle('no-bg', !s.background);
    root.classList.toggle('blur-inactive', s.blurInactive);
    root.classList.remove(...LAYOUTS.map((x) => `layout-${x.id}`));
    root.classList.add(`layout-${s.layout}`);
    root.classList.toggle('align-center', s.align === 'center');
    root.style.setProperty('--yl-weight', String(s.weight));
    root.style.setProperty('--yl-lyrics-font', (FONTS.find((f) => f.id === s.font) || FONTS[0]).family);
    root.style.setProperty('--yl-bg-dim', String(s.bgDim));
    updateRing();
    applyAccent();
    panel.sync(s);
    needMeasure = true;
    activeIdx = -2;
  }

  function updateRing() {
    viz.setRingTarget(noLyrics || settings.get().layout === 'split' ? sideCover : null);
  }

  // текста нет — обложка крупно по центру, вместо пустого экрана с заголовком
  function setNoLyrics(on) {
    if (on === noLyrics) return;
    noLyrics = on;
    root.classList.toggle('no-lyrics', on);
    updateRing();
  }

  // ---------- публичное API ----------
  function setTrack(m) {
    title.textContent = m?.title || '';
    artist.textContent = m?.artist || '';
    const img = m?.artwork ? `url("${m.artwork}")` : '';
    if (img !== cover.style.backgroundImage) {
      cover.style.backgroundImage = img;
      sideCover.style.backgroundImage = img;
      sideCover.classList.remove('is-swapping');
      void sideCover.offsetWidth; // перезапуск анимации смены обложки
      sideCover.classList.add('is-swapping');
    }
    sideTitle.textContent = m?.title || '';
    sideArtist.textContent = m?.artist || '';
    bg.setCover(m?.artwork || '');
    viz.newTrack();
    fab.classList.toggle('is-visible', !!m);
    setStatus('loading');
    setLyrics(null);
  }

  function setResult(res) {
    fab.classList.toggle('has-synced', !!res?.synced);
    if (!res) {
      setLyrics(null);
      setNoLyrics(true);
      return setStatus('notfound');
    }
    if (res.instrumental) {
      setLyrics(null);
      setNoLyrics(true);
      return setStatus('instrumental');
    }
    setNoLyrics(false);
    sourceLabel.textContent = `${res.wordSync ? 'Тайминги по словам' : res.synced ? 'Тайминги по строкам' : 'Без таймингов'} · ${res.source}`;
    setLyrics(buildTimeline(parseLrc(res.raw), player.duration()));
    setStatus(null);
  }

  function setStatus(kind) {
    status.classList.toggle('is-visible', !!kind);
    if (!kind) return;
    sourceLabel.textContent = '';
    if (kind === 'loading') {
      status.innerHTML = '<div><span class="yl-loader"><i></i><i></i><i></i></span><div class="yl-status-text">Ищу текст…</div></div>';
    }
    if (kind === 'instrumental') {
      status.innerHTML = `<div><span class="yl-status-icon">${ICON.note}</span><div class="yl-status-title">Инструментал</div><div class="yl-status-text">В этом треке нет слов — просто слушай</div></div>`;
    }
    if (kind === 'notfound') {
      status.innerHTML = `<div><span class="yl-status-icon">${ICON.search}</span><div class="yl-status-title">Текст не найден</div><div class="yl-status-text">Искал в Яндекс Музыке, LRCLIB, NetEase и lyrics.ovh. У редких треков текста иногда нет нигде.</div><button class="yl-status-btn">Поискать ещё раз</button></div>`;
      status.querySelector('button').onclick = onRetry;
    }
  }

  function setLyrics(tl) {
    timeline = tl;
    linesBox.textContent = '';
    items = [];
    activeIdx = -2;
    userOffset = 0;
    root.classList.toggle('yl-unsynced', !!tl && !tl.synced);
    stage.classList.toggle('yl-unsynced', !!tl && !tl.synced);
    if (!tl) return;
    let n = 0;
    for (const data of tl.lines) {
      if (data.type === 'interlude') {
        const e = el('div', 'yl-interlude', '<i class="yl-dot"></i><i class="yl-dot"></i><i class="yl-dot"></i>');
        items.push({ data, el: e, words: [], dots: [...e.children] });
        linesBox.append(e);
        continue;
      }
      const e = el('div', 'yl-line');
      e.style.setProperty('--i', String(n++));
      if (data.type === 'gap') e.style.height = 'calc(var(--yl-size) * 0.6)';
      const words = [];
      if (data.words) {
        data.words.forEach((w, i) => {
          const s = el('span', 'yl-w');
          s.textContent = i < data.words.length - 1 ? `${w.text} ` : w.text;
          words.push(s);
          e.append(s);
        });
      } else e.textContent = data.text || '';
      if (data.start != null) e.addEventListener('click', () => player.seek(Math.max(0, data.start - settings.get().offset + 0.02)));
      items.push({ data, el: e, words, dots: [] });
      linesBox.append(e);
    }
    // текст появляется волной
    linesBox.classList.remove('is-entering');
    void linesBox.offsetWidth;
    linesBox.classList.add('is-entering');
    clearTimeout(enterTimer);
    enterTimer = setTimeout(() => linesBox.classList.remove('is-entering'), 1700);
    needMeasure = true;
  }

  // ---------- полный экран ----------
  // окно разворачивает главный процесс (setFullScreen); без моста — HTML Fullscreen API
  let fullscreen = false;
  let fsByUs = false; // выходим из полного экрана при закрытии, только если сами в него вошли
  const native = window.ymLyricsNative;

  function showFullscreen(on) {
    fullscreen = on;
    fsBtn.innerHTML = on ? ICON.shrink : ICON.expand;
    fsBtn.title = on ? 'Выйти из полноэкранного режима (F)' : 'Во весь экран (F)';
    fsBtn.setAttribute('aria-label', on ? 'Выйти из полноэкранного режима' : 'Во весь экран');
    fsBtn.classList.toggle('is-on', on);
    // в полноэкранном режиме рамки окна не видно — даём свою кнопку «свернуть»
    root.classList.toggle('is-fullscreen', on);
  }

  async function setFullscreen(on) {
    try {
      if (native?.fullscreen) showFullscreen(await native.fullscreen(on));
      else if (on) await document.documentElement.requestFullscreen();
      else if (document.fullscreenElement) await document.exitFullscreen();
    } catch (e) {
      console.warn('[ym-lyrics] fullscreen failed', e);
    }
    fsByUs = on && fullscreen;
  }

  // состояние могло поменяться снаружи (Esc у окна, F11, другая кнопка приложения)
  async function syncFullscreen() {
    if (native?.fullscreen) {
      try {
        showFullscreen(await native.fullscreen(null));
      } catch {}
    } else showFullscreen(!!document.fullscreenElement);
    if (!fullscreen) fsByUs = false;
  }
  document.addEventListener('fullscreenchange', syncFullscreen);
  let fsTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(fsTimer);
    fsTimer = setTimeout(syncFullscreen, 150);
  });
  minBtn.onclick = (e) => {
    e.stopPropagation();
    if (native?.minimize) native.minimize();
  };
  fsBtn.onclick = (e) => {
    e.stopPropagation();
    setFullscreen(!fullscreen);
  };

  function toggle(force) {
    open = force ?? !open;
    if (open) viz.resize();
    root.classList.toggle('is-open', open);
    if (open) syncFullscreen();
    if (!open) {
      panel.close();
      tap.release?.();
      if (fsByUs) setFullscreen(false);
    }
    if (open) {
      needMeasure = true;
      activeIdx = -2;
      lastFrame = performance.now();
    }
  }

  // ---------- кадр ----------
  function frame(now) {
    requestAnimationFrame(frame);
    if (!open) return;
    // лимит кадров: на 144 Гц мониторе без него рисовали бы 144 раза в секунду; на паузе хватит 20
    const fps = player.isPlaying() ? settings.get().fps : 20;
    if (now - lastDraw < 1000 / fps - 2) return;
    lastDraw = now;
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    const dur = player.duration();
    const t = player.position() + settings.get().offset;

    viz.frame(now, dt);
    const frac = dragFrac ?? (dur ? clamp01(t / dur) : 0);
    if (now > nextLikeCheck) {
      nextLikeCheck = now + 400;
      showLike(player.likeState(), false);
      showDislike(player.dislikeState());
    }
    progressBar.style.transform = `scaleX(${frac})`;
    progressKnob.style.left = `${frac * 100}%`;
    curTime.textContent = fmt(t);
    durTime.textContent = fmt(dur);
    const playing = player.isPlaying();
    if (playing !== shownPlaying) {
      shownPlaying = playing;
      playBtn.innerHTML = playing ? ICON.pause : ICON.play;
    }
    if (panel.isOpen()) panel.status(viz.status());

    if (!timeline) return;
    const stageH = stage.clientHeight;

    if (timeline.synced) {
      const idx = findActive(timeline.lines, t);
      if (idx !== activeIdx) {
        onActiveChange(idx);
        needMeasure = true;
      }
      if (idx >= 0) updateWords(items[idx], t);
      if (needMeasure) {
        const anchor = items[Math.max(0, idx)]?.el;
        targetY = anchor ? stageH * 0.42 - (anchor.offsetTop + (idx < 0 ? 0 : anchor.offsetHeight / 2)) : 0;
        needMeasure = false;
      }
    } else {
      const h = linesBox.scrollHeight;
      const p = dur ? clamp01((t - 8) / Math.max(1, dur - 25)) : 0;
      targetY = stageH * 0.35 - p * Math.max(0, h - stageH * 0.5);
    }

    if (now - lastWheel > 2500) userOffset *= Math.exp(-dt * 5);
    const goal = targetY + userOffset;
    y += (goal - y) * (1 - Math.exp(-dt * 7));
    const ty = y.toFixed(1);
    if (ty !== shownY) {
      shownY = ty;
      linesBox.style.transform = `translate3d(0, ${ty}px, 0)`;
    }
  }
  requestAnimationFrame(frame);

  // смена строки: трогаем только строки, у которых что-то поменялось. Раньше переписывались классы,
  // слова и радиус размытия у всех строк сразу — браузер перерисовывал всё, и на смене строки был рывок
  const blurStep = (d) => (d >= 3 ? 3 : d); // ступени размытия: соседние строки размыты, дальние — одинаково
  function onActiveChange(idx) {
    const prevIdx = activeIdx;
    activeIdx = idx;
    const all = prevIdx < -1 || Math.abs(idx - prevIdx) > 6; // первый показ, перемотка
    const from = all ? 0 : Math.max(0, Math.min(prevIdx, idx) - 3);
    const to = all ? items.length - 1 : Math.min(items.length - 1, Math.max(prevIdx, idx) + 3);
    for (let i = from; i <= to; i++) {
      const it = items[i];
      const active = i === idx;
      const past = i < idx;
      const step = String(blurStep(Math.abs(i - idx)));
      if (it._active !== active) {
        it._active = active;
        it.el.classList.toggle('is-active', active);
        if (!active && i === prevIdx) resetWords(it, past); // допеть прошлую строку до конца
      }
      if (it._past !== past) {
        it._past = past;
        it.el.classList.toggle('is-past', past);
        resetWords(it, past);
      }
      if (it._step !== step) {
        it._step = step;
        it.el.dataset.d = step;
      }
    }
    if (items[idx]) resetWords(items[idx], false);
  }

  // сбрасываем и классы, и кэш состояния слова, иначе updateWords сочтёт, что менять нечего
  function resetWords(it, done) {
    for (const w of it.words) {
      w._p = done ? '1.000' : '0.000';
      w._on = false;
      w._done = done;
      w.style.setProperty('--p', done ? '1' : '0');
      w.classList.remove('is-on');
      w.classList.toggle('is-done', done);
    }
  }

  function updateWords(it, t) {
    const d = it.data;
    if (d.type === 'interlude') {
      const p = clamp01((t - d.start) / (d.end - d.start));
      it.dots.forEach((dot, i) => dot.style.setProperty('--p', clamp01(p * 3 - i).toFixed(3)));
      return;
    }
    if (!d.words) return;
    d.words.forEach((w, i) => {
      const span = it.words[i];
      const p = clamp01((t - w.start) / Math.max(0.05, w.end - w.start));
      const ps = p.toFixed(3);
      if (span._p !== ps) {
        span._p = ps;
        span.style.setProperty('--p', ps);
      }
      const on = t >= w.start && t < w.end;
      const done = t >= w.end;
      if (span._on !== on) {
        span._on = on;
        span.classList.toggle('is-on', on);
      }
      if (span._done !== done) {
        span._done = done;
        span.classList.toggle('is-done', done);
      }
    });
  }

  // ---------- ввод ----------
  stage.addEventListener(
    'wheel',
    (e) => {
      userOffset -= e.deltaY;
      lastWheel = performance.now();
    },
    { passive: true },
  );
  window.addEventListener('resize', () => (needMeasure = true));
  fab.onclick = () => toggle();
  closeBtn.onclick = () => toggle(false);
  gearBtn.onclick = (e) => {
    e.stopPropagation();
    panel.toggle();
    gearBtn.classList.toggle('is-on', panel.isOpen());
  };
  root.addEventListener('click', (e) => {
    if (!panel.el.contains(e.target) && !gearBtn.contains(e.target)) {
      panel.close();
      gearBtn.classList.remove('is-on');
    }
  });

  window.addEventListener(
    'keydown',
    (e) => {
      const tag = e.target?.tagName;
      if (e.__ylSynthetic) return; // наша же горячая клавиша для приложения (лайк)
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'KeyL') {
        e.preventDefault();
        e.stopImmediatePropagation(); // у Яндекс Музыки L — перемотка вперёд
        toggle();
      } else if (open && e.code === 'KeyF') {
        e.preventDefault();
        e.stopPropagation();
        setFullscreen(!fullscreen);
      } else if (open && e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (panel.isOpen()) panel.close();
        else toggle(false);
      } else if (open && e.code === 'Space') {
        e.preventDefault();
        e.stopPropagation();
        player.togglePlay();
      }
    },
    true,
  );

  // ---------- панель настроек ----------
  function buildPanel() {
    const p = el('div', 'yl-panel');
    const group = (title, body) => `<section class="yl-group"><h4 class="yl-group-title">${title}</h4>${body}</section>`;
    const chips = (list, key) => `<div class="yl-chips">${list.map((x) => `<button class="yl-chip" data-${key}="${x.id}">${x.name}</button>`).join('')}</div>`;
    const range = (k, min, max, step, label) =>
      `<div class="yl-row"><input class="yl-range" type="range" min="${min}" max="${max}" step="${step}" data-k="${k}" aria-label="${label}"><output data-o="${k}"></output></div>`;
    const sw = (k, label) => `<label class="yl-switch">${label}<input type="checkbox" role="switch" data-k="${k}"></label>`;
    const swatches = `<div class="yl-swatches">${ACCENTS.map((a) => `<button class="yl-swatch" data-accent="${a.id}" title="${a.name}" aria-label="${a.name}" style="--c:${a.c?.[0] || 'transparent'}"></button>`).join('')}</div>`;
    const sub = (t) => `<div class="yl-sub">${t}</div>`;
    p.innerHTML =
      group('Визуализатор', chips(VISUALIZERS, 'viz')) +
      group('Раскладка', chips(LAYOUTS, 'layout')) +
      group('Анимация слов', chips(STYLES, 'style')) +
      group('Шрифт', `<div class="yl-chips yl-fonts">${FONTS.map((f) => `<button class="yl-chip" data-font="${f.id}" style="font-family:${f.family.replace(/"/g, '&quot;')}, var(--yl-font)">${f.name}</button>`).join('')}</div>`) +
      group('Текст', range('fontSize', 28, 76, 2, 'Размер текста') + sub('Выравнивание') + chips(ALIGNS, 'align') + sub('Толщина') + chips(WEIGHTS, 'weight')) +
      group('Цвет акцента', swatches) +
      group('Бит', sub('Толчок') + range('punch', 0, 2, 0.1, 'Толчок в бит') + sub('Свечение') + range('glow', 0, 2, 0.1, 'Свечение в бит') + sub('Спектр') + range('intensity', 0.3, 1.8, 0.1, 'Сила спектра')) +
      group('Фон', sub('Затемнение') + range('bgDim', 0, 0.6, 0.05, 'Затемнение фона') + sub('Частицы') + chips(PARTICLES, 'particles')) +
      group('Плавность', chips(FPS, 'fps')) +
      group(
        'Сдвиг таймингов',
        `<div class="yl-row"><button class="yl-chip" data-off="-0.1">−0,1 с</button><output class="yl-offset" data-o="offset"></output><button class="yl-chip" data-off="0.1">+0,1 с</button><button class="yl-chip" data-off="0" title="Сбросить" aria-label="Сбросить сдвиг">${ICON.reset}</button></div>`,
      ) +
      group('Вид', sw('background', 'Фон из обложки') + sw('blurInactive', 'Размывать соседние строки') + sw('beatPulse', 'Реакция на бит') + sw('appTheme', 'Тема всего приложения из обложки') + '<div class="yl-audio-status"></div>');
    p.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.style) settings.set({ style: b.dataset.style });
      if (b.dataset.viz) settings.set({ visualizer: b.dataset.viz });
      if (b.dataset.layout) settings.set({ layout: b.dataset.layout });
      if (b.dataset.align) settings.set({ align: b.dataset.align });
      if (b.dataset.weight) settings.set({ weight: Number(b.dataset.weight) });
      if (b.dataset.particles) settings.set({ particlesAmount: b.dataset.particles });
      if (b.dataset.fps) settings.set({ fps: Number(b.dataset.fps) });
      if (b.dataset.accent) settings.set({ accent: b.dataset.accent });
      if (b.dataset.font) settings.set({ font: b.dataset.font });
      if (b.dataset.off != null) {
        const v = Number(b.dataset.off);
        settings.set({ offset: v === 0 ? 0 : Math.round((settings.get().offset + v) * 10) / 10 });
      }
    });
    p.addEventListener('input', (e) => {
      const k = e.target.dataset.k;
      if (!k) return;
      settings.set({ [k]: e.target.type === 'checkbox' ? e.target.checked : Number(e.target.value) });
      if (e.target.type === 'range') fillRange(e.target);
    });
    return {
      el: p,
      toggle: () => p.classList.toggle('is-open'),
      close: () => p.classList.remove('is-open'),
      isOpen: () => p.classList.contains('is-open'),
      status({ hasAudio, bpm, hint, source }) {
        const from = source ? ` · ${source}` : '';
        const base = hint ? ` (по базе ${Math.round(hint)})` : '';
        const text = !hasAudio ? 'Ищу звук… если долго — кликни по экрану' : bpm ? `Бит пойман · ${bpm} BPM${base}${from}` : `Слушаю звук · ищу темп…${base}${from}`;
        const s = p.querySelector('.yl-audio-status');
        if (s.textContent !== text) s.textContent = text;
        s.classList.toggle('is-ok', hasAudio);
      },
      sync(s) {
        p.querySelectorAll('[data-style]').forEach((b) => b.classList.toggle('is-on', b.dataset.style === s.style));
        p.querySelector('[data-k="fontSize"]').value = s.fontSize;
        p.querySelector('[data-o="fontSize"]').textContent = `${s.fontSize}px`;
        p.querySelector('[data-o="offset"]').textContent = `${s.offset > 0 ? '+' : s.offset < 0 ? '−' : ''}${Math.abs(s.offset).toFixed(1).replace('.', ',')} с`;
        p.querySelector('[data-k="background"]').checked = s.background;
        p.querySelector('[data-k="blurInactive"]').checked = s.blurInactive;
        p.querySelector('[data-k="beatPulse"]').checked = s.beatPulse;
        p.querySelector('[data-k="appTheme"]').checked = s.appTheme;
        for (const k of ['intensity', 'punch', 'glow', 'bgDim']) {
          p.querySelector(`[data-k="${k}"]`).value = s[k];
          p.querySelector(`[data-o="${k}"]`).textContent = `${Math.round(s[k] * 100)}%`;
        }
        const on = (attr, v) => p.querySelectorAll(`[data-${attr}]`).forEach((b) => b.classList.toggle('is-on', b.dataset[attr] === String(v)));
        on('align', s.align);
        on('weight', s.weight);
        on('particles', s.particlesAmount);
        on('fps', s.fps);
        on('accent', s.accent);
        on('font', s.font);
        p.querySelectorAll('.yl-range').forEach(fillRange);
        p.querySelectorAll('[data-viz]').forEach((b) => b.classList.toggle('is-on', b.dataset.viz === s.visualizer));
        p.querySelectorAll('[data-layout]').forEach((b) => b.classList.toggle('is-on', b.dataset.layout === s.layout));
      },
    };
  }

  return { setTrack, setResult, toggle, setTempoHint: (b) => viz.setTempoHint(b), get isOpen() {
    return open;
  } };
}

// заливка дорожки ползунка до текущего значения
function fillRange(r) {
  const v = ((Number(r.value) - Number(r.min)) / (Number(r.max) - Number(r.min))) * 100;
  r.style.setProperty('--fill', `${v}%`);
}

function fmt(s) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}
