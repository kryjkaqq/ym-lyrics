import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fold, primaryArtist, titleVariants, trackKey, translit, similarity } from '../src/renderer/normalize.js';
import { lrclib, pickBest } from '../src/renderer/providers/lrclib.js';
import { createLyricsFinder } from '../src/renderer/providers/index.js';
import { rememberYandexLyrics } from '../src/renderer/providers/yandex.js';
import { createCache } from '../src/renderer/cache.js';

const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};

const TRACK = { title: 'Ночной Трамвай (feat. Кто-то)', artist: 'Группа Ёлка, Гость', album: 'Альбом', duration: 200 };

test('normalize helpers', () => {
  assert.equal(fold('Ёжик, в Тумане!'), 'ежик в тумане');
  assert.equal(primaryArtist('A, B & C'), 'A');
  assert.deepEqual(titleVariants('Song (feat. X) - Remastered 2011'), ['Song (feat. X) - Remastered 2011', 'Song - Remastered 2011', 'Song']);
  assert.equal(translit('Привет Мир'), 'Privet Mir');
  assert.ok(similarity('Night Tram', 'night tram!') === 1);
  assert.equal(trackKey(TRACK), trackKey({ ...TRACK, duration: 201 }));
});

test('pickBest filters by duration and prefers synced', () => {
  const recs = [
    { trackName: 'Ночной Трамвай', artistName: 'Группа Елка', duration: 260, syncedLyrics: '[00:01.00]x' },
    { trackName: 'Ночной Трамвай', artistName: 'Группа Елка', duration: 201, plainLyrics: 'x' },
    { trackName: 'Ночной Трамвай', artistName: 'Группа Елка', duration: 199, syncedLyrics: '[00:01.00]y' },
    { trackName: 'Другое', artistName: 'Группа Елка', duration: 200, syncedLyrics: '[00:01.00]z' },
  ];
  assert.equal(pickBest(recs, TRACK), recs[2]);
});

test('lrclib: exact hit returns synced', async () => {
  const calls = [];
  const getJson = async (url) => {
    calls.push(url);
    return { status: 200, json: { syncedLyrics: '[00:01.00]выдуманная строка' } };
  };
  const res = await lrclib(TRACK, { getJson });
  assert.equal(res.synced, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/api\/get\?/);
  assert.match(calls[0], /duration=200/);
});

test('lrclib: falls back to search with cleaned title', async () => {
  const getJson = async (url) => {
    if (url.includes('/get?')) return { status: 404, json: null };
    if (url.includes('track_name=%D0%9D%D0%BE%D1%87%D0%BD%D0%BE%D0%B9%20%D0%A2%D1%80%D0%B0%D0%BC%D0%B2%D0%B0%D0%B9&'))
      return { status: 200, json: [{ trackName: 'Ночной трамвай', artistName: 'Группа Елка', duration: 200.4, syncedLyrics: '[00:02.00]ok' }] };
    return { status: 200, json: [] };
  };
  const res = await lrclib(TRACK, { getJson });
  assert.equal(res?.raw, '[00:02.00]ok');
});

test('lrclib: returns plain when nothing synced', async () => {
  const getJson = async (url) => (url.includes('/get?') ? { status: 200, json: { plainLyrics: 'просто текст' } } : { status: 200, json: [] });
  const res = await lrclib(TRACK, { getJson });
  assert.deepEqual(res, { source: 'LRCLIB', synced: false, raw: 'просто текст' });
});

test('finder: yandex captured lyrics win, results cached, negatives cached', async () => {
  let net = 0;
  const getJson = async () => {
    net++;
    return { status: 404, json: null };
  };
  const finder = createLyricsFinder({ cache: createCache(memStorage()), getJson });
  const other = { title: 'Нет такой', artist: 'Никто', duration: 100 };
  assert.equal(await finder.find(other), null);
  const before = net;
  assert.equal(await finder.find(other), null);
  assert.equal(net, before, 'negative result cached');

  rememberYandexLyrics(finder.keyOf(TRACK), '[00:01.00]из приложения');
  const res = await finder.find(TRACK);
  assert.equal(res.source, 'Яндекс Музыка');
});

test('finder: network errors are not cached', async () => {
  let fail = true;
  const getJson = async () => {
    if (fail) throw new Error('offline');
    return { status: 200, json: { syncedLyrics: '[00:01.00]есть' } };
  };
  const finder = createLyricsFinder({ cache: createCache(memStorage()), getJson, order: ['lrclib'] });
  const t = { title: 'Песня', artist: 'Автор', duration: 120 };
  assert.equal(await finder.find(t), null);
  fail = false;
  assert.equal((await finder.find(t)).synced, true);
});

test('cache evicts expired negatives', () => {
  let now = 0;
  const c = createCache(memStorage(), { now: () => now });
  c.set('a', null);
  assert.equal(c.get('a'), null);
  now = 25 * 3600 * 1000;
  assert.equal(c.get('a'), undefined);
});

test('finder: wrong duration (stale player data) does not hide lyrics — retried without it', async () => {
  // плеер отдал длительность предыдущего трека: 95 с вместо 200 с
  const stale = { ...TRACK, duration: 95 };
  const getJson = async (url) => {
    if (url.includes('/get?')) return { status: 404, json: null };
    return { status: 200, json: [{ trackName: 'Ночной Трамвай', artistName: 'Группа Ёлка', duration: 200, syncedLyrics: '[00:01.00]строка' }] };
  };
  const finder = createLyricsFinder({ cache: createCache(memStorage()), getJson, order: ['lrclib'] });
  const res = await finder.find(stale);
  assert.equal(res?.synced, true);
});
