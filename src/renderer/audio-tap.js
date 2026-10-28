// Доступ к звуку для визуализатора. Источники по порядку, берётся первый, в котором реально есть сигнал:
//  1. граф Web Audio самого приложения — оно строит его для своей анимации и эквалайзера;
//     подключаемся параллельно (createMediaElementSource / connect к destination), звук не трогаем;
//  2. audio.captureStream() — копия потока элемента;
//  3. системный звук (loopback через getDisplayMedia, обработчик в main-hook) — когда первые два молчат,
//     например при расшифровке трека внутри приложения.
// Источник, который молчит при играющем треке, помечается и на время пропускается.
// Свой createMediaElementSource не создаём: второй такой вызов на тот же <audio> сломал бы приложение.

const SILENT_AFTER = 1.2; // с тишины при игре — источник считается немым

export function installAudioTap() {
  const elTaps = new Map(); // <audio> -> analyser в контексте приложения
  const ctxTaps = new Map(); // AudioContext приложения -> analyser на всё, что идёт в динамики
  const captures = new WeakMap(); // <audio> -> { stream, source, analyser, trackId }
  const muted = new WeakSet(); // analyser, признанный немым (снимается, как только в нём появится звук)
  const quiet = new WeakMap(); // analyser -> сколько секунд молчит при игре
  const scratch = new Uint8Array(1024);
  let ctx = null;
  let loop = null; // null | 'pending' | 'failed' | { analyser, track, kind }
  let wantLoop = false;
  let current = null;
  let lastCheck = performance.now();

  const AC = window.AudioContext || window.webkitAudioContext;
  const ours = new WeakSet();
  const origConnect = AudioNode.prototype.connect;

  function makeAnalyser(c) {
    const a = c.createAnalyser();
    a.fftSize = 2048;
    a.smoothingTimeConstant = 0.3; // меньше сглаживания — точнее моменты ударов
    a.minDecibels = -85;
    a.maxDecibels = -18;
    ours.add(a);
    return a;
  }

  if (AC?.prototype?.createMediaElementSource) {
    const orig = AC.prototype.createMediaElementSource;
    AC.prototype.createMediaElementSource = function (el) {
      const node = orig.call(this, el);
      try {
        const analyser = makeAnalyser(this);
        origConnect.call(node, analyser);
        elTaps.set(el, analyser);
      } catch (e) {
        console.warn('[ym-lyrics] app audio tap failed', e);
      }
      return node;
    };
  }

  // всё, что приложение отправляет в динамики, дублируем в анализатор этого контекста
  AudioNode.prototype.connect = function (dest) {
    const r = origConnect.apply(this, arguments);
    try {
      if (dest instanceof AudioDestinationNode && !ours.has(this)) {
        let a = ctxTaps.get(this.context);
        if (!a) ctxTaps.set(this.context, (a = makeAnalyser(this.context)));
        origConnect.call(this, a);
      }
    } catch {}
    return r;
  };

  function ourCtx() {
    ctx ??= new AC({ latencyHint: 'interactive' });
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function captureFor(el) {
    if (!el?.captureStream || !AC) return null;
    let cap = captures.get(el);
    if (!cap) {
      let stream;
      try {
        stream = el.captureStream();
      } catch (e) {
        captures.set(el, { failed: true });
        console.warn('[ym-lyrics] captureStream failed', e);
        return null;
      }
      cap = { stream, source: null, analyser: makeAnalyser(ourCtx()), trackId: '' };
      captures.set(el, cap);
    }
    if (cap.failed) return null;
    ourCtx();
    // при смене трека у элемента меняется аудиодорожка потока — переподключаемся
    const track = cap.stream.getAudioTracks().find((t) => t.readyState === 'live');
    if (!track) return null;
    if (track.id !== cap.trackId) {
      try {
        cap.source?.disconnect();
        cap.source = ctx.createMediaStreamSource(new MediaStream([track]));
        origConnect.call(cap.source, cap.analyser);
        cap.trackId = track.id;
      } catch (e) {
        console.warn('[ym-lyrics] capture source failed', e);
        return null;
      }
    }
    return cap.analyser;
  }

  async function startLoopback() {
    if (loop || !navigator.mediaDevices?.getDisplayMedia) return;
    loop = 'pending';
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: { width: 16, height: 16, frameRate: 1 } });
      stream.getVideoTracks().forEach((t) => t.stop()); // картинка не нужна, только звук
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error('no loopback audio track');
      const src = ourCtx().createMediaStreamSource(new MediaStream([track]));
      const analyser = makeAnalyser(ctx);
      origConnect.call(src, analyser);
      loop = { analyser, track };
      track.addEventListener('ended', () => {
        if (loop?.track === track) loop = null;
      });
    } catch (e) {
      loop = 'failed';
      console.warn('[ym-lyrics] system audio capture failed', e);
    }
  }

  // getDisplayMedia может требовать жест пользователя — повторяем попытку на ближайшем клике/клавише
  const onGesture = () => {
    if (wantLoop && (loop === null || loop === 'failed')) {
      loop = null;
      startLoopback();
    }
  };
  window.addEventListener('pointerdown', onGesture, true);
  window.addEventListener('keydown', onGesture, true);

  function level(a) {
    a.getByteFrequencyData(scratch);
    let sum = 0;
    for (let i = 0; i < scratch.length; i += 4) sum += scratch[i];
    return sum;
  }

  return {
    // analyser с живым звуком или null
    get(el, playing) {
      const now = performance.now();
      const dt = Math.min(0.5, (now - lastCheck) / 1000);
      lastCheck = now;

      const list = [];
      if (el && elTaps.get(el)) list.push(elTaps.get(el));
      for (const [c, a] of ctxTaps) if (c.state === 'running') list.push(a);
      // captureStream создаём, только если граф приложения не помог
      if (el && (captures.has(el) || !list.some((a) => !muted.has(a)))) {
        const cap = captureFor(el);
        if (cap) list.push(cap);
      }
      if (loop?.analyser) list.push(loop.analyser);

      // немые источники проверяем фоном: зазвучали — снова в деле
      for (const a of list) if (muted.has(a) && level(a) > 0) muted.delete(a);

      const best = list.find((a) => !muted.has(a)) || null;
      if (best !== current) {
        current = best;
        if (current) quiet.set(current, 0);
      }
      if (current) {
        if (!playing || level(current) > 0) quiet.set(current, 0);
        else {
          const q = (quiet.get(current) || 0) + dt;
          quiet.set(current, q);
          if (q > SILENT_AFTER) {
            muted.add(current);
            current = list.find((a) => !muted.has(a)) || null;
            if (current) quiet.set(current, 0);
          }
        }
      }
      // все источники немые, а музыка играет — подключаем системный звук
      wantLoop = playing && !current;
      if (wantLoop && loop === null) startLoopback();
      return current;
    },
    source() {
      if (!current) return '';
      if (current === loop?.analyser) return 'системный звук';
      for (const a of elTaps.values()) if (a === current) return 'плеер приложения';
      for (const a of ctxTaps.values()) if (a === current) return 'плеер приложения';
      return 'поток трека';
    },
    // при закрытии режима отпускаем системный захват
    release() {
      if (loop?.track) loop.track.stop();
      if (current && current === loop?.analyser) current = null;
      if (loop !== 'pending') loop = null;
    },
    // задержка между данными анализатора и звуком в колонках
    latency() {
      const c = current?.context || ctx;
      if (!c) return 0.03;
      return (c.baseLatency || 0) + (c.outputLatency || 0.02);
    },
  };
}
