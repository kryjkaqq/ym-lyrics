// Цепочка источников текстов с кэшем и защитой от параллельных одинаковых запросов.
// Выбирается лучший по таймингам результат: по словам > по строкам > без таймингов > «инструментал».

import { trackKey } from '../normalize.js';
import { lrclib } from './lrclib.js';
import { yandex } from './yandex.js';
import { netease } from './netease.js';
import { lyricsovh } from './lyricsovh.js';

export const PROVIDERS = { yandex, lrclib, netease, lyricsovh };
export const DEFAULT_ORDER = ['yandex', 'lrclib', 'netease', 'lyricsovh'];

export const RANK = { WORD: 4, LINE: 3, PLAIN: 2, INSTRUMENTAL: 1, NONE: 0 };

// лучший результат, который источник в принципе может отдать — чтобы не опрашивать бесполезные
const CAN_GIVE = { yandex: RANK.LINE, lrclib: RANK.WORD, netease: RANK.WORD, lyricsovh: RANK.PLAIN };

// enhanced LRC: <mm:ss.xx> перед словами внутри строки
const WORD_TAG = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/;

export function rankOf(res) {
  if (!res || res.error) return RANK.NONE;
  if (res.instrumental) return RANK.INSTRUMENTAL;
  if (res.synced && (res.wordSync || WORD_TAG.test(res.raw))) return RANK.WORD;
  if (res.synced) return RANK.LINE;
  return res.raw ? RANK.PLAIN : RANK.NONE;
}

export function createLyricsFinder({ cache, getJson, order = DEFAULT_ORDER }) {
  const inflight = new Map();

  async function run(track, key) {
    const res = await runOnce(track, key);
    // длительность могла оказаться неточной (другая версия трека, данные плеера не успели обновиться) —
    // фильтр ±4 с тогда отсекает всех кандидатов; ищем ещё раз без неё, по названию и исполнителю
    if (!res && track.duration) return runOnce({ ...track, duration: undefined }, key);
    return res;
  }

  async function runOnce(track, key) {
    let best = null;
    let bestRank = RANK.NONE;
    let hadError = false;
    for (const name of order) {
      const provider = PROVIDERS[name];
      if (!provider) continue;
      // источник не может дать ничего лучше уже найденного — пропускаем
      if ((CAN_GIVE[name] ?? RANK.WORD) <= bestRank) continue;
      try {
        const res = await provider(track, { getJson, key });
        const r = rankOf(res);
        if (r > bestRank) {
          best = { ...res, wordSync: r === RANK.WORD };
          bestRank = r;
        }
        if (bestRank === RANK.WORD) break; // лучше не бывает
      } catch (e) {
        console.warn('[ym-lyrics]', name, 'failed', e);
        hadError = true;
      }
    }
    // ничего не нашли, но какой-то источник был недоступен — не кэшируем как «не найдено»
    if (!best && hadError) return { error: true };
    // нашли только текст без таймингов, а источник с таймингами был недоступен — показываем, но не кэшируем,
    // чтобы в следующий раз снова попробовать найти тайминги
    if (best && hadError && bestRank < RANK.LINE) return { ...best, transient: true };
    return best;
  }

  return {
    async find(track, { force = false } = {}) {
      const key = trackKey(track);
      if (!force) {
        const cached = cache.get(key);
        if (cached !== undefined) return cached;
      }
      if (inflight.has(key)) return inflight.get(key);
      const p = run(track, key)
        .then((res) => {
          if (res?.error) return null;
          if (res?.transient) {
            const { transient, ...shown } = res;
            return shown;
          }
          cache.set(key, res);
          return res;
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    },
    keyOf: trackKey,
  };
}
