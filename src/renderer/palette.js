// Палитра из обложки: из пикселей собирается вся тема интерфейса.
// Чистая логика: на вход RGBA-массив (например, 32×32 из canvas), на выход — цвета в hsl().
//
//  base    — тон фона: тёмный, приглушённый оттенок обложки
//  accent  — главный акцент: самый «живой» цвет обложки, поднятый до светлоты, читаемой на тёмном
//  accent2 — второй акцент: заметно другой оттенок с обложки, иначе аналоговый сдвиг
//  ink     — цвет спетых слов и активных элементов: почти белый с оттенком акцента
//  dim     — неспетые/неактивные строки: тот же оттенок, полупрозрачный
//  onInk   — цвет иконки на кнопке цвета ink

export function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

export const hueDist = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const hsl = ({ h, s, l }, a) =>
  `hsl(${Math.round(((h % 360) + 360) % 360)} ${Math.round(clamp(s, 0, 1) * 100)}% ${Math.round(clamp(l, 0, 1) * 100)}%${a == null ? '' : ` / ${a}`})`;

// относительная яркость по WCAG — для проверки контраста
export function luminance({ h, s, l }) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(f(0)) + 0.7152 * lin(f(8)) + 0.0722 * lin(f(4));
}

export const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// группы по оттенку: вес = число пикселей × насыщенность × «средняя» светлота
function clusters(pixels) {
  const bins = new Map();
  let total = 0;
  let satSum = 0;
  let lightSum = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const c = rgbToHsl(pixels[i], pixels[i + 1], pixels[i + 2]);
    total++;
    satSum += c.s;
    lightSum += c.l;
    if (c.s < 0.12 || c.l < 0.07 || c.l > 0.95) continue; // серые и почти чёрные/белые не задают оттенок
    const key = Math.round(c.h / 15) % 24;
    const b = bins.get(key) || { n: 0, x: 0, y: 0, s: 0, l: 0, w: 0 };
    const w = c.s * (1 - Math.abs(c.l - 0.5) * 1.2);
    b.n++;
    b.x += Math.cos((c.h * Math.PI) / 180) * w; // средний оттенок по кругу
    b.y += Math.sin((c.h * Math.PI) / 180) * w;
    b.s += c.s;
    b.l += c.l;
    b.w += w;
    bins.set(key, b);
  }
  const list = [...bins.values()]
    .filter((b) => b.n >= Math.max(2, total * 0.01))
    .map((b) => ({ h: (Math.atan2(b.y, b.x) * 180) / Math.PI, s: b.s / b.n, l: b.l / b.n, n: b.n, w: b.w }))
    .map((b) => ({ ...b, h: (b.h + 360) % 360, score: b.w * (0.4 + b.s) }))
    .sort((a, b) => b.score - a.score);
  return { list, total, avgSat: total ? satSum / total : 0, avgLight: total ? lightSum / total : 0 };
}

export function extractPalette(pixels) {
  const { list, avgSat, avgLight } = clusters(pixels);
  const mono = avgSat < 0.1 || !list.length;
  if (mono) {
    // чёрно-белая обложка — сдержанная холодная тема без выдуманных цветов
    return paletteFrom({ h: 225, s: 0.08, l: 0.78 }, { h: 225, s: 0.05, l: 0.62 }, { h: 225, s: 0.06, l: 0.07 + avgLight * 0.05 }, true);
  }
  const main = list[0];
  const second = list.slice(1).find((c) => hueDist(c.h, main.h) > 40 && c.score > main.score * 0.12);
  const accent = { h: main.h, s: clamp(main.s * 1.15, 0.55, 0.95), l: 0.64 };
  const accent2 = second
    ? { h: second.h, s: clamp(second.s * 1.15, 0.5, 0.95), l: 0.6 }
    : { h: main.h + (main.h > 40 && main.h < 200 ? -38 : 38), s: accent.s * 0.9, l: 0.58 };
  // фон: оттенок самой «массивной» группы, тёмный и приглушённый
  const massive = [...list].sort((a, b) => b.n - a.n)[0];
  const base = { h: massive.h, s: clamp(massive.s * 0.55, 0.15, 0.45), l: clamp(0.06 + avgLight * 0.08, 0.06, 0.12) };
  return paletteFrom(accent, accent2, base, false);
}

function paletteFrom(accent, accent2, base, mono) {
  const ink = { h: accent.h, s: mono ? 0.05 : 0.6, l: 0.95 };
  // акцент как текст на фоне должен читаться (≥4.5:1) — поднимаем светлоту, пока не прочитается
  const a = { ...accent };
  while (contrast(a, base) < 4.5 && a.l < 0.9) a.l += 0.02;
  return {
    mono,
    accent: hsl(a),
    accent2: hsl(accent2),
    base: hsl(base),
    baseDeep: hsl({ ...base, l: base.l * 0.55 }),
    ink: hsl(ink),
    dim: hsl({ h: accent.h, s: mono ? 0.04 : 0.25, l: 0.86 }, 0.34),
    soft: hsl({ h: accent.h, s: mono ? 0.04 : 0.3, l: 0.9 }, 0.62),
    glow: hsl(a, 0.55),
    onInk: hsl({ h: base.h, s: clamp(base.s, 0.1, 0.4), l: 0.1 }),
    raw: { accent: a, accent2, base, ink },
  };
}

// пока обложка не загружена
export const DEFAULT_PALETTE = paletteFrom({ h: 46, s: 1, l: 0.6 }, { h: 14, s: 1, l: 0.6 }, { h: 260, s: 0.3, l: 0.1 }, false);
