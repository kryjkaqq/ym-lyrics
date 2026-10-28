import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPalette, rgbToHsl, contrast, hueDist, DEFAULT_PALETTE } from '../src/renderer/palette.js';

// синтетическая «обложка» 32×32 из областей заданных цветов
function cover(regions) {
  const px = new Uint8ClampedArray(32 * 32 * 4);
  let i = 0;
  for (const [rgb, share] of regions) {
    const n = Math.round(32 * 32 * share);
    for (let k = 0; k < n && i < 32 * 32; k++, i++) px.set([...rgb, 255], i * 4);
  }
  for (; i < 32 * 32; i++) px.set([...regions[0][0], 255], i * 4);
  return px;
}

const hueOf = (css) => Number(css.match(/hsl\((\d+)/)[1]);
const satOf = (css) => Number(css.match(/hsl\(\d+ (\d+)%/)[1]);

test('rgbToHsl basics', () => {
  assert.deepEqual(rgbToHsl(255, 0, 0), { h: 0, s: 1, l: 0.5 });
  assert.equal(Math.round(rgbToHsl(0, 0, 255).h), 240);
});

test('vivid red cover → red accent, dark reddish base, readable accent', () => {
  const p = extractPalette(cover([[[200, 30, 40], 0.8], [[20, 10, 10], 0.2]]));
  assert.ok(hueDist(hueOf(p.accent), 356) < 12, p.accent);
  assert.equal(p.mono, false);
  assert.ok(contrast(p.raw.accent, p.raw.base) >= 4.5);
  assert.ok(p.raw.base.l <= 0.12);
});

test('two-tone cover → accent2 takes the second hue', () => {
  const p = extractPalette(cover([[[30, 90, 230], 0.55], [[250, 170, 20], 0.45]]));
  assert.ok(hueDist(hueOf(p.accent), hueOf(p.accent2)) > 90, `${p.accent} vs ${p.accent2}`);
});

test('single-hue cover → analogous accent2', () => {
  const p = extractPalette(cover([[[40, 180, 90], 1]]));
  const d = hueDist(hueOf(p.accent), hueOf(p.accent2));
  assert.ok(d > 25 && d < 50, `d=${d}`);
});

test('grayscale cover → restrained mono palette', () => {
  const p = extractPalette(cover([[[30, 30, 30], 0.6], [[200, 200, 200], 0.4]]));
  assert.equal(p.mono, true);
  assert.ok(satOf(p.accent) <= 10);
});

test('mostly dark cover with a small bright spot still finds the colour', () => {
  const p = extractPalette(cover([[[8, 8, 12], 0.9], [[255, 60, 180], 0.1]]));
  assert.equal(p.mono, false);
  assert.ok(hueDist(hueOf(p.accent), 320) < 15, p.accent);
});

test('default palette is valid', () => {
  assert.match(DEFAULT_PALETTE.accent, /^hsl\(/);
  assert.match(DEFAULT_PALETTE.dim, / \/ 0\.34\)$/);
});
