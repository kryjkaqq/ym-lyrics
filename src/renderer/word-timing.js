// Строит таймлайн для отрисовки: у каждой строки start/end, у каждого слова start/end.
// Если тайминги слов не пришли — распределяем время строки по словам пропорционально «весу» слова.

export const INTERLUDE_MIN_GAP = 4.5;
const LAST_LINE_HOLD = 6;

export function wordWeight(word) {
  const letters = word.replace(/[^\p{L}\p{N}]/gu, '').length;
  const vowels = (word.match(/[aeiouyаеёиоуыэюя]/giu) || []).length;
  return 0.6 + letters * 0.35 + vowels * 0.5;
}

// сколько времени «поётся» строка, если реальных таймингов нет
export function estimateSpeech(text, available) {
  const chars = text.replace(/\s+/g, '').length;
  const guess = Math.max(1.1, chars * 0.1);
  return Math.min(available * 0.92, guess);
}

function distribute(words, start, end) {
  const total = words.reduce((s, w) => s + wordWeight(w), 0) || 1;
  let t = start;
  return words.map((text) => {
    const d = ((end - start) * wordWeight(text)) / total;
    const w = { text, start: t, end: t + d };
    t += d;
    return w;
  });
}

function timedWords(words, lineStart, lineEnd) {
  // заполняем пропуски (слова без собственной метки) — делим отрезок между известными метками
  const out = words.map((w) => ({ text: w.text, start: w.start }));
  if (out[0].start == null) out[0].start = lineStart;
  let i = 0;
  while (i < out.length) {
    let j = i + 1;
    while (j < out.length && out[j].start == null) j++;
    const segEnd = j < out.length ? out[j].start : null;
    if (j - i > 1 || segEnd == null) {
      const from = out[i].start;
      const to = segEnd ?? Math.min(lineEnd, from + estimateSpeech(out.slice(i).map((w) => w.text).join(' '), lineEnd - from));
      const filled = distribute(out.slice(i, j).map((w) => w.text), from, to);
      filled.forEach((f, k) => (out[i + k] = f));
    }
    i = j;
  }
  for (let k = 0; k < out.length; k++) {
    if (out[k].end == null) out[k].end = k + 1 < out.length ? out[k + 1].start : Math.min(lineEnd, out[k].start + 0.8);
  }
  return out;
}

export function buildTimeline(parsed, duration) {
  if (!parsed?.synced) {
    return {
      synced: false,
      lines: (parsed?.lines ?? []).map((l) => ({ type: l.text ? 'line' : 'gap', text: l.text, start: null, end: null, words: null })),
    };
  }
  const src = parsed.lines;
  const items = [];
  for (let i = 0; i < src.length; i++) {
    const cur = src[i];
    const nextStart = i + 1 < src.length ? src[i + 1].start : (duration && duration > cur.start ? duration : cur.start + LAST_LINE_HOLD);
    if (!cur.text) continue; // пустая строка = пауза, отметка конца предыдущей
    const available = Math.max(0.2, nextStart - cur.start);
    let words;
    let end;
    if (cur.words?.length) {
      words = timedWords(cur.words, cur.start, nextStart);
      end = Math.min(nextStart, words[words.length - 1].end);
    } else {
      end = cur.start + estimateSpeech(cur.text, available);
      words = distribute(cur.text.split(/\s+/).filter(Boolean), cur.start, end);
    }
    items.push({ type: 'line', text: cur.text, start: cur.start, end, until: nextStart, words });
  }

  // проигрыши: вступление и длинные паузы между строками
  const out = [];
  if (items.length && items[0].start >= INTERLUDE_MIN_GAP) {
    out.push({ type: 'interlude', start: 0.3, end: items[0].start - 0.15 });
  }
  for (let i = 0; i < items.length; i++) {
    out.push(items[i]);
    const next = items[i + 1];
    if (next && next.start - items[i].end >= INTERLUDE_MIN_GAP) {
      out.push({ type: 'interlude', start: items[i].end + 0.4, end: next.start - 0.15 });
    }
  }
  return { synced: true, lines: out };
}

// индекс активного элемента (последний с start <= t), -1 до начала
export function findActive(lines, t) {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].start <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
