import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBandEdges, createAnalysis, estimatePeriod, gridFit } from '../src/renderer/audio-analysis.js';

const SR = 48000;
const FFT = 2048;
const binHz = SR / FFT;
const FPS = 60;

function spectrum({ bass = 0, mid = 0, high = 0 }) {
  const f = new Uint8Array(FFT / 2);
  for (let i = 0; i < f.length; i++) {
    const hz = i * binHz;
    f[i] = hz < 160 ? bass : hz < 3000 ? mid : high;
  }
  return f;
}

// псевдослучайность с фиксированным зерном — тесты воспроизводимы
function rng(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// трек: бочка с периодом `period`, джиттер, пропуски ударов, хэт и постоянный фон
function simulate(a, { period, seconds, jitter = 0.015, miss = 0, seed = 1, start = 0, silent = false }) {
  const rand = rng(seed);
  const kicks = [];
  for (let t = 0.3; t < seconds; t += period) if (rand() >= miss) kicks.push(t + (rand() - 0.5) * 2 * jitter);
  const beats = [];
  for (let f = 0; f < seconds * FPS; f++) {
    const t = f / FPS;
    let bass = 50;
    for (const k of kicks) if (t >= k && t - k < 0.12) bass = Math.max(bass, 240 - (t - k) * 1200);
    const hat = ((t - 0.3) / (period / 2)) % 1 < 0.08 ? 120 : 40; // хэт восьмыми в темпе трека
    const r = a.update(spectrum(silent ? {} : { bass, mid: 70 + rand() * 20, high: hat }), SR, FFT, start + t, 1 / FPS);
    if (r.beat) beats.push(start + t);
  }
  return { beats, kicks };
}

test('band edges are ordered and within range', () => {
  const edges = makeBandEdges(64, SR, FFT);
  assert.equal(edges.length, 64);
  for (let i = 0; i < edges.length; i++) {
    assert.ok(edges[i][0] <= edges[i][1]);
    assert.ok(edges[i][1] < FFT / 2);
    if (i) assert.ok(edges[i][0] >= edges[i - 1][0]);
  }
});

test('bands follow the spectrum and decay smoothly', () => {
  const a = createAnalysis();
  let r;
  for (let i = 0; i < 10; i++) r = a.update(spectrum({ bass: 250, mid: 40 }), SR, FFT, i / 60, 1 / 60);
  assert.ok(r.bands[1] > 0.8);
  assert.ok(r.bands[60] < 0.1);
  const before = r.bands[1];
  r = a.update(spectrum({}), SR, FFT, 11 / 60, 1 / 60);
  assert.ok(r.bands[1] < before && r.bands[1] > before - 0.1, 'smooth release');
});

test('estimatePeriod finds tempo and folds double/half time', () => {
  const at = (p, n) => Array.from({ length: n }, (_, i) => i * p);
  assert.ok(Math.abs(estimatePeriod(at(0.5, 12)) - 0.5) < 0.01);
  // удары через один (половинный темп 60 BPM) приводятся в диапазон 70–180
  assert.ok(Math.abs(estimatePeriod(at(1.0, 10)) - 0.5) < 0.01);
  assert.equal(estimatePeriod([0, 1]), 0);
});

test('gridFit measures how well onsets sit on the grid', () => {
  const on = [0, 0.5, 1.0, 1.52, 2.0];
  assert.equal(gridFit(on, 0.5, 0), 1);
  assert.ok(gridFit([0.25, 0.75, 1.25], 0.5, 0) === 0);
});

test('locks to 120 BPM and pulses on the beat despite jitter and missed kicks', () => {
  const a = createAnalysis();
  const { beats } = simulate(a, { period: 0.5, seconds: 14, miss: 0.25, seed: 7 });
  const late = beats.filter((t) => t > 5);
  assert.ok(late.length >= 15 && late.length <= 19, `beats after lock=${late.length}`);
  // интервалы ровные — пропущенные удары заполнены сеткой
  for (let i = 1; i < late.length; i++) {
    const d = late[i] - late[i - 1];
    assert.ok(Math.abs(d - 0.5) < 0.06, `interval ${d.toFixed(3)}`);
  }
  // пульс совпадает с фазой ударов (сетка от 0.3 с с шагом 0.5)
  for (const t of late) {
    const ph = (((t - 0.3) / 0.5) % 1 + 1) % 1;
    assert.ok(Math.min(ph, 1 - ph) * 0.5 < 0.06, `phase error at ${t.toFixed(2)}`);
  }
});

test('works at 92 BPM too', () => {
  const a = createAnalysis();
  const period = 60 / 92;
  const { beats } = simulate(a, { period, seconds: 16, seed: 3 });
  const late = beats.filter((t) => t > 6);
  const avg = (late.at(-1) - late[0]) / (late.length - 1);
  assert.ok(Math.abs(avg - period) < 0.02, `avg=${avg}`);
});

test('latency delays pulses by the given amount', () => {
  const a = createAnalysis({ latency: 0.1 });
  const { beats } = simulate(a, { period: 0.5, seconds: 10, seed: 5 });
  const late = beats.filter((t) => t > 5);
  for (const t of late) {
    const ph = (((t - 0.4) / 0.5) % 1 + 1) % 1;
    assert.ok(Math.min(ph, 1 - ph) * 0.5 < 0.06, `phase at ${t.toFixed(2)}`);
  }
});

test('silence produces no pulses; idle mode never pulses', () => {
  const a = createAnalysis();
  simulate(a, { period: 0.5, seconds: 8, seed: 2 });
  const { beats } = simulate(a, { period: 0.5, seconds: 4, start: 8, silent: true });
  assert.ok(beats.filter((t) => t > 8.6).length === 0, 'grid released in silence');
  const b = createAnalysis();
  for (let i = 0; i < 300; i++) assert.equal(b.idle(i / 60, 1 / 60, true).beat, false);
});

// гибкий трек: события { t, band: 'bass'|'mid', level }
function play(a, events, seconds, { start = 0, seed = 11 } = {}) {
  const rand = rng(seed);
  const beats = [];
  const pulses = [];
  for (let f = 0; f < seconds * FPS; f++) {
    const t = f / FPS;
    let bass = 50;
    let mid = 70 + rand() * 15;
    for (const e of events) {
      if (t < e.t || t - e.t >= 0.12) continue;
      const v = 50 + (e.level ?? 190) * (1 - (t - e.t) / 0.12);
      if (e.band === 'mid') mid = Math.max(mid, v);
      else bass = Math.max(bass, v);
    }
    const r = a.update(spectrum({ bass, mid, high: 40 }), SR, FFT, start + t, 1 / FPS);
    if (r.beat) beats.push({ t: start + t, strength: r.strength });
    pulses.push(r.pulse);
  }
  return { beats, pulses };
}

const grid = (period, from, to, extra = {}) => {
  const out = [];
  for (let t = from; t < to; t += period) out.push({ t, ...extra });
  return out;
};

const phaseErr = (t, origin, period) => {
  const ph = (((t - origin) / period) % 1 + 1) % 1;
  return Math.min(ph, 1 - ph) * period;
};

test('locks on a track without kick drum (snare / claps in the mids)', () => {
  const a = createAnalysis();
  const { beats } = play(a, grid(0.5, 0.3, 14, { band: 'mid' }), 14);
  const late = beats.filter((b) => b.t > 6);
  assert.ok(late.length >= 14, `beats=${late.length}`);
  for (const b of late) assert.ok(phaseErr(b.t, 0.3, 0.5) < 0.06, `phase at ${b.t.toFixed(2)}`);
});

test('syncopated off-beat hits do not pull the grid off the downbeats', () => {
  const a = createAnalysis();
  const rand = rng(4);
  const ev = grid(0.5, 0.3, 16);
  // слабые синкопы между долями примерно на трети восьмых
  for (let t = 0.55; t < 16; t += 0.5) if (rand() < 0.35) ev.push({ t, band: 'mid', level: 110 });
  const { beats } = play(a, ev, 16);
  const late = beats.filter((b) => b.t > 7);
  assert.ok(late.length >= 16, `beats=${late.length}`);
  for (const b of late) assert.ok(phaseErr(b.t, 0.3, 0.5) < 0.06, `phase at ${b.t.toFixed(2)}`);
});

test('follows a tempo change 120 → 100 BPM', () => {
  const a = createAnalysis();
  const p2 = 0.6;
  const ev = [...grid(0.5, 0.3, 10), ...grid(p2, 10.1, 24)];
  const { beats } = play(a, ev, 24);
  const late = beats.filter((b) => b.t > 18);
  const avg = (late.at(-1).t - late[0].t) / (late.length - 1);
  assert.ok(Math.abs(avg - p2) < 0.02, `avg=${avg.toFixed(3)}`);
  for (const b of late) assert.ok(phaseErr(b.t, 10.1, p2) < 0.07, `phase at ${b.t.toFixed(2)}`);
});

test('random hits without a rhythm give (almost) no pulses', () => {
  const a = createAnalysis();
  const rand = rng(9);
  const ev = [];
  for (let t = 0.2; t < 14; t += 0.15 + rand() * 0.9) ev.push({ t });
  const { beats } = play(a, ev, 14);
  assert.ok(beats.length <= 6, `beats=${beats.length}`);
});

test('missed beats pulse softly, real hits strongly; pulse never jumps above 1', () => {
  const a = createAnalysis();
  // каждая четвёртая доля пропущена
  const ev = grid(0.5, 0.3, 14).filter((_, i) => i % 4 !== 3);
  const { beats, pulses } = play(a, ev, 14);
  const late = beats.filter((b) => b.t > 6);
  const missed = late.filter((b) => Math.round((b.t - 0.3) / 0.5) % 4 === 3);
  const hit = late.filter((b) => Math.round((b.t - 0.3) / 0.5) % 4 !== 3);
  assert.ok(missed.length >= 2 && hit.length >= 8);
  const avg = (xs) => xs.reduce((s, b) => s + b.strength, 0) / xs.length;
  assert.ok(avg(hit) > 0.7, `hit=${avg(hit)}`);
  assert.ok(avg(missed) < 0.25, `missed=${avg(missed)}`);
  assert.ok(Math.max(...pulses) <= 1);
});

test('seek by half a beat: the grid re-phases within ~2 s', () => {
  const a = createAnalysis();
  // до 8 с доли на 0.3 + k·0.5, после «перемотки» — на 0.05 + k·0.5 (сдвиг на полдоли)
  const ev = [...grid(0.5, 0.3, 8), ...grid(0.5, 8.05, 16)];
  const { beats } = play(a, ev, 16);
  const after = beats.filter((b) => b.t > 10.5);
  assert.ok(after.length >= 9, `beats=${after.length}`);
  for (const b of after) assert.ok(phaseErr(b.t, 8.05, 0.5) < 0.06, `phase at ${b.t.toFixed(2)}`);
});

test('the loud first beat of the bar gets the accent and a bigger punch', () => {
  const a = createAnalysis();
  // «раз» громкий, остальные доли тише
  const ev = grid(0.5, 0.3, 16).map((e, i) => ({ ...e, level: i % 4 === 0 ? 200 : 120 }));
  const beats = [];
  const rand = rng(5);
  for (let f = 0; f < 16 * FPS; f++) {
    const t = f / FPS;
    let bass = 50;
    for (const e of ev) if (t >= e.t && t - e.t < 0.12) bass = Math.max(bass, 50 + e.level * (1 - (t - e.t) / 0.12));
    const r = a.update(spectrum({ bass, mid: 70 + rand() * 15, high: 40 }), SR, FFT, t, 1 / FPS);
    if (r.beat && t > 8) beats.push({ t, accent: r.accent });
  }
  const isOne = (t) => Math.round((t - 0.3) / 0.5) % 4 === 0;
  const ones = beats.filter((b) => isOne(b.t));
  const others = beats.filter((b) => !isOne(b.t));
  assert.ok(ones.length >= 3 && ones.every((b) => b.accent), 'downbeats accented');
  assert.ok(others.filter((b) => b.accent).length <= 1, 'other beats not accented');
});

test('tempo hint settles the half/double-time dispute', () => {
  const ev = grid(60 / 160, 0.3, 14);
  const late = (a) => {
    const { beats } = play(a, ev, 14);
    const b = beats.filter((x) => x.t > 7);
    return (b.at(-1).t - b[0].t) / (b.length - 1);
  };
  const hinted = createAnalysis();
  hinted.setTempoHint(160);
  assert.ok(Math.abs(late(hinted) - 60 / 160) < 0.01, 'with hint: 160 BPM');
  // подсказка вдвое меньше (так бывает в базах) приводится к тому же диапазону и не мешает
  const half = createAnalysis();
  half.setTempoHint(40);
  const p = late(half);
  assert.ok(Math.abs(p - 60 / 160) < 0.01 || Math.abs(p - 60 / 80) < 0.02, `half hint: ${p}`);
});
