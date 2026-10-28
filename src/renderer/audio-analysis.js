// Разбор спектра: логарифмические полосы для эквалайзера, бас/середина/верх и бит.
// Бит:
//  1. огибающие атак по трём полосам — бочка, середина (малый, хлопки), верх (хэты) — каждая нормирована
//     на свой средний уровень и пересэмплирована в ровные 100 Гц;
//  2. темп — сумма нормированных автокорреляций полос (доля + полутакт + такт) с мягким приоритетом около
//     120 BPM; оценка стартует уже с 2 с звука, стабильный темп захватывается сразу; «вдвое» подавляется;
//  3. фаза — гребёнка с найденным периодом по огибающей, затем плавная подстройка сетки (PLL);
//  4. пульс идёт по сетке, его сила — от реального удара на этой доле (слабые доли тише, пропуски — едва заметно).
// Пока сетка не поймана — пульса нет: лучше без бита, чем мигание невпопад.
// Чистая логика без DOM — на вход Uint8Array из AnalyserNode.getByteFrequencyData.

export const BAND_COUNT = 64;

const MIN_PERIOD = 60 / 170; // 170 BPM
const MAX_PERIOD = 60 / 80; //  80 BPM — медленнее сворачивается в двойной темп: пульс на каждую долю смотрится лучше, чем вялый
const ENV_HZ = 100; // частота огибающей атак
const ENV_SECONDS = 6; // окно для оценки темпа
const TEMPO_EVERY = 0.25; // с — как часто пересчитывать темп
const MIN_SECONDS = 2.2; // с звука до первой оценки темпа
const LOCK_CONF = 0.36; // уверенность для захвата (случайные удары и вокал без барабанов дают до ~0.32)
const STABLE_CONF = 0.2; // уверенность для захвата, если темп стабилен три оценки подряд или совпал с подсказкой
const UNLOCK_CONF = 0.1; // ниже — ритм пропал, сетку отпускаем
const RELEASE_AFTER = 2.5; // с без атак — сетка отпускается

export function makeBandEdges(n, sampleRate, fftSize, fMin = 35, fMax = 16000) {
  const binHz = sampleRate / fftSize;
  const maxBin = fftSize / 2 - 1;
  const edges = [];
  let prevEnd = 0;
  for (let i = 0; i < n; i++) {
    const f0 = fMin * Math.pow(fMax / fMin, i / n);
    const f1 = fMin * Math.pow(fMax / fMin, (i + 1) / n);
    const s = Math.max(prevEnd, Math.floor(f0 / binHz));
    const e = Math.max(s, Math.min(maxBin, Math.ceil(f1 / binHz) - 1));
    edges.push([s, e]);
    prevEnd = Math.min(maxBin, e + 1);
  }
  return edges;
}

function rangeAvg(freq, binHz, lo, hi) {
  const s = Math.max(0, Math.floor(lo / binHz));
  const e = Math.min(freq.length - 1, Math.ceil(hi / binHz));
  let sum = 0;
  for (let i = s; i <= e; i++) sum += freq[i];
  return sum / Math.max(1, e - s + 1) / 255;
}

// период по межударным интервалам: гистограмма с приведением к диапазону 70–180 BPM
export function estimatePeriod(onsets) {
  if (onsets.length < 4) return 0;
  const bins = new Float32Array(110); // шаг 5 мс от MIN_PERIOD
  const step = 0.005;
  for (let i = 0; i < onsets.length; i++) {
    for (let j = i + 1; j < onsets.length && j <= i + 4; j++) {
      let d = onsets[j] - onsets[i];
      if (d < 0.2 || d > 2.6) continue;
      while (d > MAX_PERIOD) d /= 2;
      while (d < MIN_PERIOD) d *= 2;
      const weight = j === i + 1 ? 1 : 0.6;
      const k = (d - MIN_PERIOD) / step;
      for (let b = Math.max(0, Math.floor(k) - 2); b <= Math.min(bins.length - 1, Math.ceil(k) + 2); b++) {
        bins[b] += weight * Math.exp(-((b - k) ** 2) / 2);
      }
    }
  }
  let best = -1;
  for (let b = 0; b < bins.length; b++) if (best < 0 || bins[b] > bins[best]) best = b;
  return bins[best] > 0 ? MIN_PERIOD + best * step : 0;
}

// доля ударов, попавших в сетку (period, anchor) с допуском ±tol
export function gridFit(onsets, period, anchor, tol = 0.06) {
  if (!period || !onsets.length) return 0;
  let hit = 0;
  for (const t of onsets) {
    const ph = (((t - anchor) / period) % 1 + 1) % 1;
    if (Math.min(ph, 1 - ph) * period <= tol) hit++;
  }
  return hit / onsets.length;
}

const ratio = (a, b) => Math.max(a, b) / Math.min(a, b);

// полосы атак: бочка, малый/хлопки/середина, хэты/тарелки
const ONSET_BANDS = [
  { lo: 30, hi: 160, stride: 1, tempo: 1, phase: 1 },
  { lo: 160, hi: 5000, stride: 2, tempo: 0.9, phase: 0.8 },
  { lo: 5000, hi: 15000, stride: 3, tempo: 0.7, phase: 0.35 },
];
const NB = ONSET_BANDS.length;
const KERNEL = [0.12, 0.5, 1, 0.5, 0.12]; // сглаживание огибающей ≈ ±20 мс — живые музыканты играют не идеально по сетке

export function createAnalysis({ bands = BAND_COUNT, latency = 0 } = {}) {
  const smooth = new Float32Array(bands);
  let edges = null;
  let edgesKey = '';
  let prev = null; // прошлый кадр по каждой полосе атак
  const bandAvg = new Float32Array(NB); // средний flux полосы — нормировка, чтобы тихие хэты весили как громкая бочка

  // огибающие атак: кольцевые буферы ровной частоты (по полосе + общая для фазы); последняя точка — envTime
  const N = ENV_HZ * ENV_SECONDS;
  const env = Array.from({ length: NB }, () => new Float32Array(N));
  const comb = new Float32Array(N);
  const series = new Float32Array(N);
  const nac = new Float32Array(N); // суммарная нормированная автокорреляция
  let envHead = 0;
  let envTime = -1;
  let filled = 0; // сколько точек накоплено с последнего сброса
  let combPeak = 0.5;
  let beatRef = 0; // средняя сила настоящих ударов на долях — эталон силы пульса
  let lastActivity = -Infinity;

  let period = 0;
  let anchor = 0; // время одной из долей (в шкале анализатора)
  let locked = false;
  let conf = 0;
  const recent = []; // последние оценки периода — для быстрого захвата по стабильности
  let challenger = 0;
  let challengerPeriod = 0;
  let phaseMiss = 0;
  let nextTempo = 0;
  let lastFiredGrid = -Infinity;
  let target = 0;
  let pulse = 0; // свечение: мягкое, ~0.3 с
  let punchTarget = 0;
  let punch = 0; // толчок: короткий, ~0.13 с — для лёгкого шейка
  const slots = new Float32Array(4); // средняя сила удара по позициям в такте — где громче, там «раз»
  let energyFast = 0;
  let energySlow = 0;
  let lat = latency;
  let hint = 0; // BPM из внешнего сервиса (Deezer), приведённый к диапазону; 0 — нет подсказки
  const out = { bands: smooth, bass: 0, mid: 0, high: 0, energy: 0, beat: false, accent: false, pulse: 0, punch: 0, drive: 1, strength: 0, bpm: 0, locked: false, conf: 0 };

  function reset() {
    for (const e of env) e.fill(0);
    comb.fill(0);
    filled = 0;
    envTime = -1;
    locked = false;
    conf = 0;
    recent.length = 0;
    beatRef = 0;
    slots.fill(0);
    lastActivity = -Infinity;
    nextTempo = 0;
  }

  const idx = (back) => (envHead - 1 - back + N * 2) % N;

  // общая огибающая в момент t (линейная интерполяция), 0 за пределами окна
  function combAt(t) {
    const back = (envTime - t) * ENV_HZ;
    if (back < 0 || back > Math.min(filled, N) - 2) return 0;
    const i0 = Math.floor(back);
    const f = back - i0;
    const a = comb[idx(i0)];
    return a + (comb[idx(i0 + 1)] - a) * f;
  }

  function combMax(t0, t1) {
    let m = 0;
    for (let t = t0; t <= t1 + 1e-9; t += 1 / ENV_HZ) m = Math.max(m, combAt(t));
    return m;
  }

  function pushEnv(now, vals) {
    if (envTime < 0 || now - envTime > 1) {
      // начало или разрыв (вкладка спала, перемотка с паузой) — начинаем заново
      for (const e of env) e.fill(0);
      comb.fill(0);
      filled = 0;
      envTime = now - 1 / ENV_HZ;
    }
    let added = false;
    while (envTime + 1 / ENV_HZ <= now + 1e-9) {
      envTime += 1 / ENV_HZ;
      for (const e of env) e[envHead] = 0;
      comb[envHead] = 0;
      envHead = (envHead + 1) % N;
      filled++;
      added = true;
    }
    const last = idx(0);
    let c = 0;
    for (let b = 0; b < NB; b++) {
      env[b][last] = added ? vals[b] : Math.max(env[b][last], vals[b]);
      c += env[b][last] * ONSET_BANDS[b].phase;
    }
    comb[last] = c;
  }

  // сглаженная огибающая полосы за последние n точек, без среднего (положительная часть); возвращает энергию
  function bandSeries(e, n) {
    let mean = 0;
    const start = envHead - n;
    for (let i = 0; i < n; i++) {
      let v = 0;
      for (let k = 0; k < KERNEL.length; k++) {
        const j = i + k - 2;
        if (j >= 0 && j < n) v += KERNEL[k] * e[(start + j + N * 2) % N];
      }
      series[i] = v;
      mean += v;
    }
    mean /= n;
    let e0 = 0;
    for (let i = 0; i < n; i++) {
      const v = Math.max(0, series[i] - mean);
      series[i] = v;
      e0 += v * v;
    }
    return e0 / n;
  }

  const minLag = Math.floor(MIN_PERIOD * ENV_HZ);
  const maxLag = Math.ceil(MAX_PERIOD * ENV_HZ);
  const score = new Float32Array(maxLag + 2);
  const needLag = new Uint8Array(maxLag * 4 + 8);
  for (let l = minLag - 1; l <= maxLag + 1; l++) needLag[l] = needLag[l * 2] = needLag[l * 4] = 1;

  function estimateTempo() {
    const n = Math.min(filled, N);
    if (n < MIN_SECONDS * ENV_HZ) return null;
    nac.fill(0);
    let wsum = 0;
    const top = Math.min(n - 1, maxLag * 4 + 4);
    for (let b = 0; b < NB; b++) {
      const e0 = bandSeries(env[b], n);
      if (e0 < 1e-9) continue;
      const w = ONSET_BANDS[b].tempo;
      wsum += w;
      // нужны только лаги L, 2L, 4L — считаем их, а не все подряд
      for (let l = minLag - 1; l <= top; l++) {
        if (!needLag[l]) continue;
        let s = 0;
        for (let i = l; i < n; i++) s += series[i] * series[i - l];
        nac[l] += (w * s) / (n - l) / e0;
      }
    }
    if (!wsum) return null;
    // длинный лаг на коротком окне считается по крошечному перекрытию и врёт — такие не учитываем
    const at = (l) => (l < n * 0.55 ? nac[l] / wsum : 0);
    // доля + полутакт + такт подтверждают период; мягкий приоритет к ~120 BPM решает спор «вдвое»
    let best = -1;
    for (let l = minLag - 1; l <= maxLag + 1; l++) {
      const bpm = (60 * ENV_HZ) / l;
      const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.75) ** 2);
      // с подсказкой темп ищем рядом с ней (±~5%), звук лишь уточняет; без неё — мягко около 120 BPM
      const near = hint ? Math.exp(-0.5 * (Math.log2(bpm / hint) / 0.04) ** 2) : 0;
      const pr = hint ? 0.35 + 0.65 * near : 0.6 + 0.4 * prior;
      score[l] = (at(l) + 0.6 * at(l * 2) + 0.5 * at(l * 4)) * pr;
      if (l >= minLag && l <= maxLag && (best < 0 || score[l] > score[best])) best = l;
    }
    const y0 = score[best - 1];
    const y1 = score[best];
    const y2 = score[best + 1];
    const d = y0 - 2 * y1 + y2;
    const off = d < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / d)) : 0;
    let mean = 0;
    for (let l = minLag; l <= maxLag; l++) mean += score[l];
    mean /= maxLag - minLag + 1;
    return { period: (best + off) / ENV_HZ, conf: y1 - mean };
  }

  // фаза: где на последних секундах гребёнка с периодом p собирает больше всего атак
  function estimatePhase(p) {
    const steps = Math.max(8, Math.round(p * ENV_HZ));
    let best = 0;
    let bestS = -1;
    for (let k = 0; k < steps; k++) {
      const ph = (k / steps) * p;
      let s = 0;
      let w = 1;
      for (let b = envTime - ph; b > envTime - 4; b -= p) {
        s += w * Math.max(combAt(b), combAt(b - 0.01), combAt(b + 0.01));
        w *= 0.75; // свежие доли важнее — после перемотки фаза перестраивается быстрее
      }
      if (s > bestS) {
        bestS = s;
        best = ph;
      }
    }
    return envTime - best;
  }

  function relock(p) {
    phaseMiss = 0;
    slots.fill(0);
    period = p;
    anchor = estimatePhase(p);
    lastFiredGrid = anchor - p * 0.5;
    challenger = 0;
  }

  function updateTempo() {
    const est = estimateTempo();
    if (!est) return;
    conf = conf * 0.5 + est.conf * 0.5;
    const p = est.period;
    recent.push(p);
    if (recent.length > 3) recent.shift();
    if (!locked) {
      // быстрый захват: темп три оценки подряд один и тот же — верим ему и при средней уверенности
      const stable = recent.length === 3 && recent.every((x) => ratio(x, p) < 1.03);
      const agrees = hint && ratio(60 / p, hint) < 1.04; // звук подтвердил подсказку — захватываем сразу
      if (conf >= LOCK_CONF || ((stable || agrees) && conf >= STABLE_CONF)) {
        locked = true;
        relock(p);
      }
      return;
    }
    if (conf < UNLOCK_CONF) {
      locked = false;
      return;
    }
    const r = ratio(p, period);
    if (r < 1.04) {
      period += (p - period) * 0.25;
      challenger = 0;
    } else {
      // другой темп: переключаемся, если он держится — ~1 с, а для «вдвое»/«в полтора» (спорные случаи) ~2.5 с
      const octave = Math.abs(r - 2) < 0.08 || Math.abs(r - 1.5) < 0.05;
      challenger = challengerPeriod && ratio(p, challengerPeriod) < 1.04 ? challenger + 1 : 1;
      challengerPeriod = p;
      if (challenger >= (octave ? 10 : 4)) return relock(p);
    }
    const ph = estimatePhase(period);
    const k = Math.round((ph - anchor) / period);
    const err = ph - (anchor + k * period);
    if (Math.abs(err) < period * 0.25) {
      anchor += err * 0.35;
      phaseMiss = 0;
    } else if (++phaseMiss >= 3) {
      // фаза сбита всерьёз (перемотка на полдоли, сбивка) — перескакиваем на новую
      anchor = ph;
      lastFiredGrid = Math.max(lastFiredGrid, ph - period);
      phaseMiss = 0;
    }
  }

  function step(now, dt, bass, mid, high, vals, active) {
    let beat = false;
    let accent = false;
    let strength = 0;
    const audible = now - lat;

    if (active) {
      pushEnv(now, vals);
      const c = comb[idx(0)];
      if (c > combPeak * 0.3) lastActivity = now;
      combPeak = Math.max(combPeak * Math.exp(-dt / 4), c, 0.3);
      if (now >= nextTempo) {
        nextTempo = now + TEMPO_EVERY;
        updateTempo();
      }
    }

    // тишина / брейк — отпускаем сетку
    if (locked && (!active || now - lastActivity > Math.max(RELEASE_AFTER, period * 4))) {
      locked = false;
      conf = 0;
      beatRef = 0;
      recent.length = 0;
    }

    if (locked) {
      const k = Math.floor((audible - anchor) / period);
      const grid = anchor + k * period;
      if (grid > lastFiredGrid + period * 0.5 && audible - grid < 0.12) {
        lastFiredGrid = grid;
        beat = true;
        // сила — по реальной атаке у этой доли (в шкале анализатора доля на lat позже)
        const hit = combMax(grid + lat - 0.06, Math.min(now, grid + lat + 0.06));
        const ref = beatRef || combPeak * 0.6;
        strength = Math.min(1, hit / (ref * 0.85));
        if (hit > ref * 0.3) beatRef = ref + (Math.min(hit, ref * 2) - ref) * 0.15;
        const slot = ((k % 4) + 4) % 4;
        slots[slot] += (Math.min(3, hit / ref) - slots[slot]) * 0.25; // без обрезки сверху — чтобы громкий «раз» выделялся
        let topSlot = 0;
        for (let i = 1; i < 4; i++) if (slots[i] > slots[topSlot]) topSlot = i;
        let rest = 0;
        for (let i = 0; i < 4; i++) if (i !== topSlot) rest += slots[i] / 3;
        // «раз» заметно громче остальных долей — акцентируем его; ровный бит (техно) — акцент на каждой
        accent = slots[topSlot] > rest * 1.12 ? slot === topSlot : true;
      }
    }

    let e = 0;
    for (let i = 0; i < bands; i++) e += smooth[i];
    e /= bands;
    // «драйв» секции: громкость сейчас относительно последних ~10 с — в припеве/дропе эффекты ярче, в куплете тише
    energyFast += (e - energyFast) * (1 - Math.exp(-dt / 0.5));
    energySlow += (e - energySlow) * (1 - Math.exp(-dt / 10));
    const drive = Math.max(0.65, Math.min(1.35, energySlow > 0.01 ? energyFast / energySlow : 1));

    // свечение: мягкая атака и плавное затухание; пропущенная доля — едва заметно
    if (beat) target = Math.max(target, (0.25 + 0.75 * strength) * (accent ? 1 : 0.7));
    target *= Math.exp(-dt / 0.28);
    pulse = target > pulse ? pulse + (target - pulse) * (1 - Math.exp(-dt / 0.03)) : target;
    // толчок: только от настоящих ударов, резкий и короткий
    if (beat) punchTarget = Math.max(punchTarget, strength ** 1.5 * (accent ? 1 : 0.55));
    punchTarget *= Math.exp(-dt / 0.13);
    punch = punchTarget > punch ? punch + (punchTarget - punch) * (1 - Math.exp(-dt / 0.012)) : punchTarget;

    out.bass = bass;
    out.mid = mid;
    out.high = high;
    out.energy = e;
    out.beat = beat;
    out.accent = accent;
    out.punch = punch;
    out.drive = drive;
    out.strength = strength;
    out.pulse = pulse;
    out.locked = locked;
    out.bpm = locked ? Math.round(60 / period) : 0;
    out.conf = conf;
    return out;
  }

  const vals = new Float32Array(NB);
  let ranges = null;

  return {
    setLatency(v) {
      lat = Math.max(0, Math.min(0.4, v || 0));
    },
    // новый трек — старая огибающая только мешает
    reset,
    // темп трека из внешнего сервиса; кратные приводятся к диапазону 80–170
    setTempoHint(bpm) {
      let b = Number(bpm) || 0;
      if (b > 0) {
        while (b < 60 / MAX_PERIOD - 0.5) b *= 2;
        while (b > 60 / MIN_PERIOD + 0.5) b /= 2;
      }
      if (Math.abs(b - hint) > 0.5) {
        hint = b;
        recent.length = 0;
        if (locked && hint && ratio(60 / period, hint) > 1.04) locked = false; // сетка явно не тот темп — перезахват
      }
    },

    update(freq, sampleRate, fftSize, now, dt) {
      const key = `${sampleRate}:${fftSize}`;
      const binHz = sampleRate / fftSize;
      if (key !== edgesKey) {
        edges = makeBandEdges(bands, sampleRate, fftSize);
        edgesKey = key;
        ranges = ONSET_BANDS.map((b) => {
          const s = Math.max(1, Math.floor(b.lo / binHz));
          const e = Math.min(freq.length - 1, Math.max(s, Math.ceil(b.hi / binHz)));
          return [s, e, b.stride];
        });
        prev = ranges.map(([s, e, st]) => new Float32Array(Math.floor((e - s) / st) + 1));
      }
      for (let i = 0; i < bands; i++) {
        const [s, e] = edges[i];
        let sum = 0;
        for (let k = s; k <= e; k++) sum += freq[k];
        let v = sum / (e - s + 1) / 255;
        v = Math.min(1, Math.pow(v, 1.35) * (1 + (i / bands) * 0.9)); // верха в музыке тише — подтягиваем
        smooth[i] = v > smooth[i] ? smooth[i] + (v - smooth[i]) * 0.65 : Math.max(v, smooth[i] - dt * 1.6);
      }

      let total = 0;
      for (let i = 0; i < freq.length; i += 4) total += freq[i];
      const active = total > 0;

      // spectral flux по полосам, нормированный на средний уровень полосы
      for (let b = 0; b < NB; b++) {
        const [s, e, st] = ranges[b];
        const p = prev[b];
        let fl = 0;
        let j = 0;
        for (let i = s; i <= e; i += st, j++) {
          const v = freq[i] / 255;
          if (v > p[j]) fl += v - p[j];
          p[j] = v;
        }
        fl /= j;
        if (active) bandAvg[b] += (fl - bandAvg[b]) * (1 - Math.exp(-dt / 3));
        vals[b] = fl / Math.max(bandAvg[b], 0.002);
      }

      const bass = rangeAvg(freq, binHz, 40, 140);
      return step(now, dt, bass, rangeAvg(freq, binHz, 400, 2000), rangeAvg(freq, binHz, 4000, 12000), vals, active);
    },

    // без доступа к звуку: спокойное «дыхание» без пульса — лучше без бита, чем бит невпопад
    idle(now, dt, playing) {
      const amp = playing ? 0.3 : 0;
      for (let i = 0; i < bands; i++) {
        const x = i / bands;
        const n = 0.5 + 0.5 * Math.sin(now * (0.9 + x * 1.4) + i * 0.7) * Math.sin(now * 0.5 + i * 1.3);
        const v = amp * (1 - x * 0.6) * (0.3 + 0.7 * n);
        smooth[i] += (v - smooth[i]) * Math.min(1, dt * 3);
      }
      locked = false;
      vals.fill(0);
      return step(now, dt, smooth[2], smooth[bands >> 2], smooth[(bands * 3) >> 2], vals, false);
    },
  };
}
