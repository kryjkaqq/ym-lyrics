// Темп трека из открытой базы Deezer (api.deezer.com, без ключа): поиск по исполнителю и названию,
// сверка по длительности, затем поле bpm у трека. Это лишь подсказка — анализ звука уточняет темп и фазу.
// Результаты (и «не знаем») кэшируются в localStorage.

import { primaryArtist, titleVariants, trackKey } from './normalize.js';
import { pickBy } from './providers/match.js';

const KEY = 'ymlyrics:bpm:v1';
const TTL_MISS = 7 * 24 * 3600 * 1000;
const MAX = 600;

export function createTempoHints({ getJson, storage = localStorage }) {
  let data = {};
  try {
    data = JSON.parse(storage.getItem(KEY) || '{}') || {};
  } catch {}
  const save = () => {
    const keys = Object.keys(data);
    if (keys.length > MAX) for (const k of keys.sort((a, b) => data[a].at - data[b].at).slice(0, keys.length - MAX)) delete data[k];
    try {
      storage.setItem(KEY, JSON.stringify(data));
    } catch {}
  };
  const inflight = new Map();

  async function lookup(track) {
    const artist = primaryArtist(track.artist);
    const title = titleVariants(track.title).at(-1);
    const res = await getJson(`https://api.deezer.com/search?q=${encodeURIComponent(`${artist} ${title}`)}&limit=15`);
    let list = res.status === 200 ? res.json?.data || [] : [];
    // у части треков bpm в базе 0 — пробуем до трёх подходящих версий (radio edit, альбомная, переиздание)
    for (let i = 0; i < 3 && list.length; i++) {
      const hit = pickBy(list, track, (t) => ({ title: t.title, artist: t.artist?.name || '', duration: t.duration }));
      if (!hit?.id) break;
      list = list.filter((t) => t !== hit);
      const full = await getJson(`https://api.deezer.com/track/${hit.id}`);
      const bpm = Number(full.json?.bpm) || 0;
      if (bpm >= 40 && bpm <= 250) return Math.round(bpm * 10) / 10;
    }
    return 0;
  }

  return {
    // BPM или 0, если неизвестен; сетевые ошибки не кэшируются
    async get(track) {
      if (!track?.title) return 0;
      const key = trackKey(track);
      const c = data[key];
      if (c && (c.bpm || Date.now() - c.at < TTL_MISS)) return c.bpm;
      if (inflight.has(key)) return inflight.get(key);
      const p = lookup(track)
        .then((bpm) => {
          data[key] = { bpm, at: Date.now() };
          save();
          return bpm;
        })
        .catch((e) => {
          console.warn('[ym-lyrics] tempo lookup failed', e);
          return 0;
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    },
  };
}
