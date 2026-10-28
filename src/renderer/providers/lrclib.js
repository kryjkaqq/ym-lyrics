// LRCLIB — открытая база синхронизированных текстов (https://lrclib.net/docs).

import { fold, primaryArtist, titleVariants, translit, hasCyrillic } from '../normalize.js';
import { pickBy } from './match.js';

const API = 'https://lrclib.net/api';

const qs = (o) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

function toResult(rec) {
  if (!rec) return null;
  if (rec.instrumental) return { source: 'LRCLIB', instrumental: true, synced: false, raw: '' };
  if (rec.syncedLyrics) return { source: 'LRCLIB', synced: true, raw: rec.syncedLyrics };
  if (rec.plainLyrics) return { source: 'LRCLIB', synced: false, raw: rec.plainLyrics };
  return null;
}

export function pickBest(records, track) {
  return pickBy(records, track, (r) =>
    r.syncedLyrics || r.plainLyrics || r.instrumental
      ? { title: r.trackName, artist: r.artistName, duration: r.duration, synced: !!r.syncedLyrics }
      : null,
  );
}

export async function lrclib(track, { getJson }) {
  const artist = primaryArtist(track.artist);
  const variants = titleVariants(track.title);
  const duration = track.duration ? Math.round(track.duration) : undefined;

  // 1. точный запрос
  const exact = await getJson(`${API}/get?${qs({ artist_name: track.artist, track_name: track.title, album_name: track.album, duration })}`);
  const exactRes = exact.status === 200 ? toResult(exact.json) : null;
  if (exactRes?.synced || exactRes?.instrumental) return exactRes;

  // 2. поиск по вариантам названия
  let plainFallback = exactRes;
  const queries = [];
  for (const v of variants.slice().reverse()) queries.push({ track_name: v, artist_name: artist });
  queries.push({ q: `${artist} ${variants.at(-1)}` });
  if (hasCyrillic(artist) || hasCyrillic(variants.at(-1))) {
    queries.push({ q: `${translit(artist)} ${translit(variants.at(-1))}` });
  }
  const seen = new Set();
  for (const q of queries) {
    const key = fold(JSON.stringify(q));
    if (seen.has(key)) continue;
    seen.add(key);
    const res = await getJson(`${API}/search?${qs(q)}`);
    if (res.status !== 200 || !Array.isArray(res.json)) continue;
    const best = toResult(pickBest(res.json, track));
    if (best?.synced || best?.instrumental) return best;
    if (best && !plainFallback) plainFallback = best;
  }
  return plainFallback;
}
