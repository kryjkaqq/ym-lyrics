// Canvas-визуализатор под текстом: эквалайзер (полосы / волны / кольцо), частицы, свечение в бит.
// Реакции интерфейса на бит (толчок обложки, строки, фона) задаются прямо в style нужных элементов:
// CSS-переменная на корне заставляла бы каждый кадр пересчитывать стили всего оверлея.

import { createAnalysis, BAND_COUNT } from '../audio-analysis.js';
import { PARTICLES as PARTICLE_LEVELS } from '../settings.js';

const PARTICLES = Math.max(...PARTICLE_LEVELS.map((x) => x.count));

export function createVisualizer(root, { tap, player, settings }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'yl-viz';
  root.querySelector('.yl-bg').after(canvas);
  const ctx = canvas.getContext('2d');
  const analysis = createAnalysis();
  let freq = new Uint8Array(1024);
  let W = 0;
  let H = 0;
  let dpr = 1;
  let colors = ['#ffdb4d', '#ff6a3d'];
  let rot = 0;
  let wavePhase = 0;
  let ringTarget = null; // элемент, вокруг которого рисуется кольцо
  let hasAudio = false;
  let lastBpm = 0;
  let tempoHint = 0;
  let fx = {}; // элементы, которые реагируют на бит
  let lastActive = null;
  let glow = 0; // свечение в бит с учётом силы эффектов и «драйва» секции
  let punch = 0; // короткий толчок от настоящего удара

  const sprite = makeGlowSprite();
  const particles = Array.from({ length: PARTICLES }, () => spawn(true));

  let footTop = 0;
  let footCheck = 0;
  // верх плеера: полосы и волны стоят на нём, а не уходят под кнопки
  function vizBase(now) {
    if (now > footCheck || !footTop) {
      footCheck = now + 500;
      const f = fx.foot?.getBoundingClientRect();
      const r = root.getBoundingClientRect();
      footTop = f && f.height ? f.top - r.top : H - 170;
    }
    return footTop - 14;
  }

  function resize() {
    // свечение и лучи не требуют чёткости ретины, а пикселей в канвасе при dpr 2 вчетверо больше
    dpr = Math.min(1.25, window.devicePixelRatio || 1);
    W = root.clientWidth;
    H = root.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  window.addEventListener('resize', resize);
  resize();

  function spawn(initial) {
    return {
      x: Math.random(),
      y: initial ? Math.random() : 1.05,
      r: 0.6 + Math.random() * 2.6,
      vy: 0.008 + Math.random() * 0.025,
      vx: (Math.random() - 0.5) * 0.01,
      a: 0.15 + Math.random() * 0.5,
      tw: Math.random() * Math.PI * 2,
      c: Math.random() < 0.5 ? 0 : 1,
    };
  }

  // запись в style только при заметном изменении — без лишних пересчётов стилей
  function put(el, prop, value) {
    if (!el) return;
    const key = `__yl_${prop}`;
    if (el[key] === value) return;
    el[key] = value;
    if (prop.startsWith('--')) el.style.setProperty(prop, value);
    else el.style[prop] = value;
  }
  const q = (x) => Math.round(x * 500) / 500; // шаг 0.002

  function applyFx(a, k) {
    const bass = Math.min(1, a.bass * k);
    put(fx.bg, 'transform', `scale(${q(1 + bass * 0.02 + punch * 0.016)})`);
    put(fx.bg, '--yl-energy', String(Math.round(Math.min(1, a.energy * k * 1.6) * 20) / 20));
    put(fx.glow, 'opacity', String(q(glow * 0.22)));
    put(fx.sideCover, 'transform', `scale(${q(1 + punch * 0.04 + bass * 0.01)})`);
    put(fx.sideGlow, 'opacity', String(q(glow * 0.75)));
    put(fx.stage, 'transform', punch > 0.002 ? `translate3d(0, ${q(punch * 3)}px, 0) scale(${q(1 + punch * 0.005)})` : '');
    put(fx.cover, 'transform', `scale(${q(1 + punch * 0.07)})`);
    put(fx.ctl, 'transform', `scale(${q(1 + punch * 0.06)})`);
    const act = fx.active?.() || null;
    if (act !== lastActive) {
      put(lastActive, 'scale', '');
      lastActive = act;
    }
    put(act, 'scale', String(q(1 + punch * 0.014)));
  }

  let silentFor = 0;
  function read(now, dt) {
    const playing = player.isPlaying();
    // tap сам выбирает источник, в котором есть звук, и переключается, если текущий замолчал
    const analyser = tap.get(player.activeAudio?.(), playing);
    if (analyser) {
      if (freq.length !== analyser.frequencyBinCount) freq = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(freq);
      let sum = 0;
      for (let i = 0; i < freq.length; i += 8) sum += freq[i];
      silentFor = sum > 0 || !playing ? 0 : silentFor + dt;
      if (silentFor < 1.5) {
        hasAudio = sum > 0 || hasAudio;
        analysis.setLatency(tap.latency?.() ?? 0);
        return analysis.update(freq, analyser.context.sampleRate, analyser.fftSize, now, dt);
      }
    }
    hasAudio = false;
    return analysis.idle(now, dt, playing);
  }

  function frame(now, dt) {
    const s = settings.get();
    const a = read(now / 1000, dt);
    lastBpm = a.bpm;
    const k = s.intensity;
    // в припеве/дропе (drive > 1) эффекты ярче, в тихом куплете — спокойнее
    glow = s.beatPulse ? Math.min(1, a.pulse * s.glow * a.drive) : 0;
    punch = s.beatPulse ? Math.min(1.2, a.punch * s.punch * a.drive) : 0;
    applyFx(a, k);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';

    if (glow > 0.02) drawBloom();
    const pc = PARTICLE_LEVELS.find((x) => x.id === s.particlesAmount)?.count ?? 90;
    if (pc) drawParticles(dt, a, k, pc);
    if (s.visualizer === 'bars') drawBars(a, k);
    else if (s.visualizer === 'wave') drawWaves(dt, a, k);
    else if (s.visualizer === 'ring') drawRing(dt, a, k);
    else if (s.visualizer === 'aura') drawAura(dt, a, k);
    else if (s.visualizer === 'ripples') drawRipples(dt, a, k);
    else if (s.visualizer === 'warp') drawWarp(dt, a, k);
    else if (s.visualizer === 'led') drawLed(dt, a, k);
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------- эффекты ----------
  // вспышка в бит — цветное свечение вокруг обложки (или под текстом по центру), а не засветка всего экрана
  function drawBloom() {
    let cx = W * 0.5;
    let cy = H * 0.45;
    let r = Math.min(W, H) * 0.5;
    let peak = 0.11; // по центру свечение лежит под текстом — тише
    const t = ringTarget?.isConnected && ringTarget.offsetParent ? ringTarget.getBoundingClientRect() : null;
    if (t && t.width) {
      const rr = root.getBoundingClientRect();
      cx = t.left - rr.left + t.width / 2;
      cy = t.top - rr.top + t.height / 2;
      r = t.width * 1.05;
      peak = 0.17;
    }
    const g = ctx.createRadialGradient(cx, cy, r * 0.25, cx, cy, r);
    g.addColorStop(0, withAlpha(colors[0], peak * glow));
    g.addColorStop(0.55, withAlpha(colors[1], peak * 0.4 * glow));
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }

  function drawParticles(dt, a, k, count) {
    const speed = 1 + a.bass * 3 * k + glow * 1.5 + punch * 5; // на ударе частицы делают рывок
    for (let i = 0; i < count; i++) {
      const p = particles[i];
      p.y -= p.vy * dt * speed;
      p.x += p.vx * dt * speed + Math.sin(p.tw + p.y * 6) * 0.0004;
      p.tw += dt * 2;
      if (p.y < -0.05 || p.x < -0.05 || p.x > 1.05) particles[i] = spawn(false);
      const size = p.r * (1 + glow * 0.35) * 6;
      ctx.globalAlpha = Math.min(0.8, p.a * (0.55 + 0.45 * Math.sin(p.tw)) * (0.5 + a.energy * 0.9));
      ctx.drawImage(sprite[p.c], p.x * W - size / 2, p.y * H - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }

  // зеркальные полосы снизу: низы в центре, верха к краям, со свечением и отражением
  function drawBars(a, k) {
    const n = BAND_COUNT;
    const total = n * 2;
    const gap = 3;
    const bw = Math.max(2, (W - 80) / total - gap);
    const base = vizBase(performance.now());
    const maxH = H * 0.2;
    const path = new Path2D();
    const refl = new Path2D();
    for (let i = 0; i < total; i++) {
      const band = i < n ? n - 1 - i : i - n;
      const v = Math.min(1, a.bands[band] * k);
      const h = v * v * maxH + v * 8;
      if (h < 2) continue; // без «пунктира» из пустых полос
      const x = 40 + i * (bw + gap);
      roundRect(path, x, base - h, bw, h, bw / 2);
      roundRect(refl, x, base + 6, bw, h * 0.35, bw / 2);
    }
    const g = ctx.createLinearGradient(0, base - maxH, 0, base);
    g.addColorStop(0, withAlpha(colors[0], 0.95));
    g.addColorStop(1, withAlpha(colors[1], 0.55));
    ctx.save();
    ctx.fillStyle = g;
    ctx.globalAlpha = 0.4;
    ctx.fill(path);
    ctx.restore();
    const rg = ctx.createLinearGradient(0, base, 0, base + maxH * 0.35);
    rg.addColorStop(0, withAlpha(colors[1], 0.22));
    rg.addColorStop(1, 'transparent');
    ctx.fillStyle = rg;
    ctx.fill(refl);
  }

  // слои плавных волн снизу экрана
  function drawWaves(dt, a, k) {
    wavePhase += dt * (0.6 + a.energy * 2);
    const layers = 3;
    for (let l = 0; l < layers; l++) {
      const pts = 48;
      const amp = H * (0.09 + l * 0.035);
      const baseY = vizBase(performance.now()) - l * 16;
      const bottom = baseY + 24; // заливка гаснет к верху плеера и под кнопки не заходит
      // гребень волны отдельно: обводим только его, заливку — до низа
      const crest = new Path2D();
      let prevX = 0;
      let prevY = baseY;
      for (let i = 0; i <= pts; i++) {
        const x = (i / pts) * W;
        const band = Math.min(BAND_COUNT - 1, Math.floor(Math.pow(i / pts, 1.6) * BAND_COUNT * 0.85) + l);
        const v = Math.min(1, a.bands[band] * k);
        const wobble = Math.sin(i * 0.35 + wavePhase * (1 + l * 0.4) + l) * 0.25 + 0.75;
        const y = baseY - v * amp * wobble;
        if (i === 0) crest.moveTo(x, y);
        else crest.quadraticCurveTo(prevX, prevY, (prevX + x) / 2, (prevY + y) / 2);
        prevX = x;
        prevY = y;
      }
      crest.lineTo(W, prevY);
      const area = new Path2D(crest);
      area.lineTo(W, bottom);
      area.lineTo(0, bottom);
      area.closePath();
      const g = ctx.createLinearGradient(0, baseY - amp, 0, bottom);
      g.addColorStop(0, withAlpha(colors[l % 2], 0.3 - l * 0.06));
      g.addColorStop(0.75, withAlpha(colors[(l + 1) % 2], 0.06));
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.fill(area);
      ctx.strokeStyle = withAlpha(colors[l % 2], 0.5 - l * 0.12);
      ctx.lineWidth = 1.5;
      ctx.stroke(crest);
    }
  }

  // центр и размер обложки (или середина экрана, если обложки на экране нет)
  function coverBox() {
    const t = ringTarget?.isConnected && ringTarget.offsetParent ? ringTarget.getBoundingClientRect() : null;
    if (t && t.width) {
      const rr = root.getBoundingClientRect();
      const radius = parseFloat(getComputedStyle(ringTarget).borderTopLeftRadius) || 0;
      return { cx: t.left - rr.left + t.width / 2, cy: t.top - rr.top + t.height / 2, w: t.width, h: t.height, radius, real: true };
    }
    const w = Math.min(W, H) * 0.42;
    return { cx: W / 2, cy: H * 0.45, w, h: w, radius: w / 2, real: false };
  }

  // «Аура»: мягкие пятна цвета обложки плавают вокруг неё и раздуваются от баса
  let auraT = 0;
  function drawAura(dt, a, k) {
    auraT += dt * (0.25 + a.energy * 0.6);
    const box = coverBox();
    const base = Math.max(box.w, box.h);
    const bandsPer = Math.floor(BAND_COUNT / 6);
    for (let i = 0; i < 6; i++) {
      let v = 0;
      for (let b = 0; b < bandsPer; b++) v += a.bands[i * bandsPer + b];
      v = Math.min(1, (v / bandsPer) * k * 1.4);
      const ang = auraT * (0.6 + i * 0.13) + (i * Math.PI) / 3;
      const orbit = base * (0.42 + 0.12 * Math.sin(auraT * 0.7 + i));
      const x = box.cx + Math.cos(ang) * orbit;
      const y = box.cy + Math.sin(ang) * orbit * 0.8;
      const r = base * (0.5 + v * 0.55 + punch * 0.15);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, withAlpha(colors[i % 2], 0.3 + v * 0.3 + glow * 0.12));
      g.addColorStop(0.5, withAlpha(colors[i % 2], 0.1 + v * 0.1));
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }

  // «Круги»: на каждый удар от обложки расходится её контур
  const ripples = [];
  function drawRipples(dt, a, k) {
    const box = coverBox();
    if (a.beat) ripples.push({ d: 0, s: (0.35 + 0.65 * a.strength) * (a.accent ? 1 : 0.6) });
    else if (!a.locked && a.bass * k > 0.55 && (ripples.at(-1)?.d ?? 99) > 60) ripples.push({ d: 0, s: 0.4 }); // без пойманного бита — по сильному басу
    if (ripples.length > 10) ripples.shift();
    const speed = 140 + a.energy * 160;
    ctx.save();
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      r.d += dt * speed;
      const life = 1 - r.d / (Math.min(W, H) * 0.55);
      if (life <= 0) {
        ripples.splice(i, 1);
        continue;
      }
      const m = 10 + r.d;
      const path = new Path2D();
      roundRect(path, box.cx - box.w / 2 - m, box.cy - box.h / 2 - m, box.w + m * 2, box.h + m * 2, box.radius + m);
      ctx.globalAlpha = life * life * r.s;
      ctx.lineWidth = 1 + r.s * 2.5 * life;
      ctx.strokeStyle = withAlpha(colors[i % 2], 0.9);
      ctx.stroke(path);
    }
    ctx.restore();
  }

  // «Тоннель»: звёзды летят навстречу, на ударах — рывок скорости
  const stars = Array.from({ length: 240 }, () => star(true));
  function star(initial) {
    return { x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2, z: initial ? Math.random() : 1, c: Math.random() < 0.5 ? 0 : 1 };
  }
  function drawWarp(dt, a, k) {
    const box = coverBox();
    const speed = (0.12 + a.bass * k * 0.5 + punch * 1.6) * dt;
    const f = Math.max(W, H) * 0.5;
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 0; i < stars.length; i++) {
      const st = stars[i];
      const z0 = st.z;
      st.z -= speed;
      if (st.z <= 0.02) {
        stars[i] = star(false);
        continue;
      }
      const x0 = box.cx + (st.x / z0) * f * 0.35;
      const y0 = box.cy + (st.y / z0) * f * 0.35;
      const x1 = box.cx + (st.x / st.z) * f * 0.35;
      const y1 = box.cy + (st.y / st.z) * f * 0.35;
      if (x1 < -50 || x1 > W + 50 || y1 < -50 || y1 > H + 50) {
        stars[i] = star(false);
        continue;
      }
      const near = 1 - st.z;
      ctx.globalAlpha = Math.min(0.95, near * (0.5 + a.energy));
      ctx.strokeStyle = colors[st.c];
      ctx.lineWidth = 0.6 + near * 2.4;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    ctx.restore();
  }

  // «Пиксели»: ретро-эквалайзер из квадратиков с падающими пиками
  const peaks = new Float32Array(48);
  function drawLed(dt, a, k) {
    const cols = 48;
    const rows = 10;
    const base = vizBase(performance.now());
    const width = Math.min(W - 80, 1100);
    const cell = width / cols;
    const cellH = Math.min(cell, (H * 0.15) / rows); // не выше ~15% экрана — не лезет на текст
    const size = cell * 0.72;
    const sizeH = cellH * 0.72;
    const x0 = (W - width) / 2;
    ctx.save();
    for (let c = 0; c < cols; c++) {
      // низы в центре, верха к краям — симметрично
      const half = cols / 2;
      const idx = c < half ? half - 1 - c : c - half;
      const band = Math.min(BAND_COUNT - 1, Math.floor((idx / half) * BAND_COUNT * 0.8));
      const v = Math.min(1, a.bands[band] * k * 1.1);
      const lit = Math.round(v * v * rows + v * 2);
      peaks[c] = Math.max(lit, peaks[c] - dt * 10);
      for (let r = 0; r < lit && r < rows; r++) {
        ctx.globalAlpha = 0.3 + (r / rows) * 0.4;
        ctx.fillStyle = r > rows * 0.7 ? colors[1] : colors[0];
        ctx.fillRect(x0 + c * cell, base - (r + 1) * cellH, size, sizeH);
      }
      const pk = Math.min(rows - 1, Math.floor(peaks[c]));
      if (pk >= 1) {
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = colors[1];
        ctx.fillRect(x0 + c * cell, base - (pk + 1) * cellH, size, sizeH * 0.5);
      }
    }
    ctx.restore();
  }

  // спектр вокруг обложки: лучи по контуру скруглённого квадрата (вокруг обложки) или по кругу (по центру).
  // Симметрично в четыре стороны: бас — на боковых сторонах (там свободно), верха — сверху и снизу,
  // где рядом кнопки и название трека; так картинка не заваливается набок и ничего не перекрывает.
  function drawRing(dt, a, k) {
    const target = ringTarget?.isConnected && ringTarget.offsetParent ? ringTarget.getBoundingClientRect() : null;
    let shape;
    let alpha;
    let maxLen;
    if (target && target.width) {
      const rr = root.getBoundingClientRect();
      const m = 12; // отступ лучей от края обложки
      const radius = (parseFloat(getComputedStyle(ringTarget).borderTopLeftRadius) || 0) + m;
      shape = roundedRectPath(target.left - rr.left - m, target.top - rr.top - m, target.width + m * 2, target.height + m * 2, radius);
      alpha = 0.7;
      maxLen = Math.max(20, Math.min(target.width * 0.16, rr.width - target.right + rr.left - 24));
    } else {
      rot += dt * (0.05 + a.energy * 0.15);
      shape = circlePath(W * 0.5, H * 0.5, Math.min(W, H) * 0.3, rot);
      alpha = 0.22; // по центру кольцо лежит под текстом — тише
      maxLen = Math.min(W, H) * 0.14;
    }
    const step = 7;
    const n = Math.max(32, Math.round(shape.length / step));
    const top = BAND_COUNT * 0.8 - 1; // самые верхние полосы почти не двигаются — не тратим на них место
    const grow = 1.5 + punch * 7; // на ударе лучи «отпрыгивают» от обложки
    const path = new Path2D();
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const u = Math.abs(((t * 4) % 2) - 1); // 0 — середина боковой стороны, 1 — середина верха / низа
      const v = Math.min(1, a.bands[Math.round(u * top)] * k);
      const len = 3 + v * v * maxLen;
      const p = shape.at(t);
      path.moveTo(p.x + p.nx * grow, p.y + p.ny * grow);
      path.lineTo(p.x + p.nx * (grow + len), p.y + p.ny * (grow + len));
    }
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, step - 3.5);
    const g = ctx.createRadialGradient(shape.cx, shape.cy, shape.h * 0.4, shape.cx, shape.cy, shape.h * 0.5 + maxLen);
    g.addColorStop(0, withAlpha(colors[0], 0.95));
    g.addColorStop(1, withAlpha(colors[1], 0.8));
    ctx.strokeStyle = g;
    // свечение — второй, широкий и прозрачный проход вместо shadowBlur (тот на порядок дороже)
    ctx.globalAlpha = alpha * (0.16 + glow * 0.14);
    ctx.lineWidth = Math.max(2, step - 3.5) * 2.6;
    ctx.stroke(path);
    ctx.lineWidth = Math.max(2, step - 3.5);
    ctx.globalAlpha = alpha;
    ctx.stroke(path);
    // тонкий контур-аура
    ctx.globalAlpha = (0.14 + glow * 0.3) * (alpha / 0.7);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = withAlpha(colors[1], 0.9);
    ctx.stroke(shape.outline);
    ctx.restore();
  }

  return {
    frame,
    resize,
    // для индикатора в настройках
    status() {
      return { hasAudio, bpm: lastBpm, hint: tempoHint, source: tap.source?.() || '' };
    },
    setPalette(p) {
      colors = [p.accent, p.accent2];
      sprite.splice(0, 2, ...makeGlowSprite([p.accent, p.ink]));
    },
    setFxTargets(t) {
      fx = t;
    },
    // новый трек: огибающая прошлого только мешает искать темп
    newTrack() {
      analysis.reset();
      analysis.setTempoHint(0);
    },
    setTempoHint(bpm) {
      analysis.setTempoHint(bpm);
      tempoHint = bpm || 0;
    },
    setRingTarget(el) {
      ringTarget = el;
    },
  };
}

// контур для лучей: at(t) — точка и внешняя нормаль на доле t периметра (t=0 — низ по центру, по часовой)
function roundedRectPath(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const arc = (Math.PI * r) / 2;
  // участки по часовой (в экранных координатах) от низа по центру
  const segs = [
    { len: w / 2 - r, at: (d) => ({ x: cx - d, y: y + h, nx: 0, ny: 1 }) },
    { len: arc, at: (d) => corner(x + r, y + h - r, Math.PI / 2 + d / r) },
    { len: h - 2 * r, at: (d) => ({ x, y: y + h - r - d, nx: -1, ny: 0 }) },
    { len: arc, at: (d) => corner(x + r, y + r, Math.PI + d / r) },
    { len: w - 2 * r, at: (d) => ({ x: x + r + d, y, nx: 0, ny: -1 }) },
    { len: arc, at: (d) => corner(x + w - r, y + r, (Math.PI * 3) / 2 + d / r) },
    { len: h - 2 * r, at: (d) => ({ x: x + w, y: y + r + d, nx: 1, ny: 0 }) },
    { len: arc, at: (d) => corner(x + w - r, y + h - r, d / r) },
    { len: w / 2 - r, at: (d) => ({ x: x + w - r - d, y: y + h, nx: 0, ny: 1 }) },
  ];
  function corner(ox, oy, ang) {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    return { x: ox + c * r, y: oy + s * r, nx: c, ny: s };
  }
  const length = segs.reduce((s, g) => s + g.len, 0);
  const outline = new Path2D();
  roundRect(outline, x, y, w, h, r);
  return {
    length,
    outline,
    cx,
    cy,
    h,
    at(t) {
      let d = (((t % 1) + 1) % 1) * length;
      for (const g of segs) {
        if (d <= g.len) return g.at(d);
        d -= g.len;
      }
      return segs[0].at(0);
    },
  };
}

function circlePath(cx, cy, r, rot = 0) {
  const outline = new Path2D();
  outline.arc(cx, cy, r, 0, Math.PI * 2);
  return {
    length: Math.PI * 2 * r,
    outline,
    cx,
    cy,
    h: r * 2,
    at(t) {
      const ang = Math.PI / 2 + t * Math.PI * 2 + Math.sin(rot) * 0.15; // лёгкое покачивание вместо вращения
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      return { x: cx + c * r, y: cy + s * r, nx: c, ny: s };
    },
  };
}

function roundRect(path, x, y, w, h, r) {
  r = Math.min(r, h / 2, w / 2);
  path.roundRect ? path.roundRect(x, y, w, h, r) : path.rect(x, y, w, h);
}

function makeGlowSprite(c = ['#ffdb4d', '#ff6a3d']) {
  return c.map((col) => {
    const s = document.createElement('canvas');
    s.width = s.height = 64;
    const x = s.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, withAlpha(col, 0.9));
    g.addColorStop(1, 'transparent');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    return s;
  });
}

// hsl(h s% l%) / #rrggbb → цвет с прозрачностью
export function withAlpha(color, a) {
  const alpha = Math.max(0, Math.min(1, a)).toFixed(3);
  if (color.startsWith('hsl(')) return color.replace(/\)$/, ` / ${alpha})`);
  if (color.startsWith('#') && color.length === 7) {
    const n = parseInt(color.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`;
  }
  return color;
}
