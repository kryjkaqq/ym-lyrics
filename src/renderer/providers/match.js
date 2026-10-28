// Общая оценка кандидата из любого источника: название, исполнитель, длительность.

import { primaryArtist, similarity, titleVariants, translit } from '../normalize.js';

export const DURATION_TOLERANCE = 4;

// candidate: { title, artist, duration (сек), synced? } → число или null, если не подходит
export function scoreCandidate(c, track) {
  const want = titleVariants(track.title).at(-1);
  const artist = primaryArtist(track.artist);
  const dd = track.duration && c.duration ? Math.abs(c.duration - track.duration) : 0;
  if (track.duration && c.duration && dd > DURATION_TOLERANCE) return null;
  const candTitle = titleVariants(c.title).at(-1);
  const ts = Math.max(similarity(candTitle, want), similarity(translit(candTitle), translit(want)));
  const as = Math.max(similarity(c.artist, track.artist), similarity(c.artist, artist), similarity(translit(c.artist), translit(artist)));
  if (ts < 0.5 || as < 0.34) return null;
  return ts * 3 + as * 2 + (c.synced ? 2 : 0) - dd * 0.3;
}

export function pickBy(list, track, toCandidate) {
  let best = null;
  let bestScore = -Infinity;
  for (const item of list || []) {
    const c = toCandidate(item);
    if (!c) continue;
    const s = scoreCandidate(c, track);
    if (s != null && s > bestScore) {
      bestScore = s;
      best = item;
    }
  }
  return best;
}
