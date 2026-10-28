// Парсер LRC: обычный ([mm:ss.xx]), несколько меток на строку, [offset:±ms],
// enhanced / A2 (<mm:ss.xx> перед словами). Без меток — несинхронизированный текст.

const LINE_TAG = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
const WORD_TAG = /<(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)>/g;
const META_TAG = /^\[([a-z#]+):(.*)\]\s*$/i;

export function toSeconds(min, sec) {
  return Number(min) * 60 + Number(String(sec).replace(':', '.'));
}

function parseWords(body) {
  if (!WORD_TAG.test(body)) return null;
  WORD_TAG.lastIndex = 0;
  const words = [];
  const parts = body.split(WORD_TAG);
  // parts: [before, m, s, text, m, s, text, ...]
  for (let i = 1; i < parts.length; i += 3) {
    const start = toSeconds(parts[i], parts[i + 1]);
    const raw = parts[i + 2] ?? '';
    const pieces = raw.split(/(\s+)/).filter((p) => p.trim());
    // один тег на группу слов — делим группу поровну позже, помечаем общим стартом
    pieces.forEach((text, k) => words.push({ text, start: k === 0 ? start : null }));
  }
  const lead = parts[0].trim();
  if (lead) lead.split(/\s+/).forEach((text) => words.unshift({ text, start: null }));
  return words.length ? words : null;
}

function stripWordTags(s) {
  return s.replace(WORD_TAG, '').replace(/\s+/g, ' ').trim();
}

export function parseLrc(input) {
  const text = String(input ?? '').replace(/\r/g, '');
  let offset = 0;
  const timed = [];
  const plain = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      plain.push('');
      continue;
    }
    LINE_TAG.lastIndex = 0;
    const stamps = [];
    let m;
    let lastEnd = 0;
    while ((m = LINE_TAG.exec(line)) && m.index === lastEnd) {
      stamps.push(toSeconds(m[1], m[2]));
      lastEnd = LINE_TAG.lastIndex;
    }
    if (!stamps.length) {
      const meta = line.match(META_TAG);
      if (meta) {
        if (meta[1].toLowerCase() === 'offset') offset = Number(meta[2]) / 1000 || 0;
        continue;
      }
      plain.push(line);
      continue;
    }
    const body = line.slice(lastEnd);
    const words = parseWords(body);
    for (const start of stamps) {
      timed.push({
        start,
        text: stripWordTags(body),
        words: words ? words.map((w) => ({ ...w })) : null,
      });
    }
  }

  if (!timed.length) {
    const lines = trimEmpty(plain).map((t) => ({ start: null, text: t, words: null }));
    return { synced: false, lines };
  }

  // offset > 0 — текст должен появляться раньше
  for (const l of timed) {
    l.start = Math.max(0, l.start - offset);
    if (l.words) for (const w of l.words) if (w.start != null) w.start = Math.max(0, w.start - offset);
  }
  timed.sort((a, b) => a.start - b.start);
  return { synced: true, lines: timed };
}

function trimEmpty(arr) {
  let a = 0;
  let b = arr.length;
  while (a < b && !arr[a]) a++;
  while (b > a && !arr[b - 1]) b--;
  // схлопываем подряд идущие пустые строки в одну
  return arr.slice(a, b).filter((t, i, s) => t || s[i - 1]);
}
