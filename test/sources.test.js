import { test } from 'node:test';
import assert from 'node:assert/strict';
import { netease, yrcToLrc, cleanLrc, msToTag } from '../src/renderer/providers/netease.js';
import { lyricsovh } from '../src/renderer/providers/lyricsovh.js';
import { createLyricsFinder } from '../src/renderer/providers/index.js';
import { createCache } from '../src/renderer/cache.js';
import { parseLrc } from '../src/renderer/lrc-parser.js';

const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};

// выдуманный трек и выдуманные строки
const TRACK = { title: 'Редкий Трек (feat. Гость)', artist: 'Малоизвестная Группа', album: 'Демо', duration: 181 };

test('msToTag formats mm:ss.xx', () => {
  assert.equal(msToTag(0), '00:00.00');
  assert.equal(msToTag(61250), '01:01.25');
});

test('yrcToLrc converts word timings and skips metadata/credits', () => {
  const yrc = [
    '{"t":0,"c":[{"tx":"meta"}]}',
    '[1000,900](1000,300,0)作词 : кто-то',
    '[5000,1200](5000,400,0)Тихий (5400,300,0)ветер (5700,500,0)шумит',
    '',
  ].join('\n');
  const lrc = yrcToLrc(yrc);
  assert.equal(lrc, '[00:05.00]<00:05.00>Тихий <00:05.40>ветер <00:05.70>шумит');
  const p = parseLrc(lrc);
  assert.deepEqual(p.lines[0].words.map((w) => w.start), [5, 5.4, 5.7]);
});

test('cleanLrc drops credit lines', () => {
  assert.equal(cleanLrc('[00:00.00] 作曲 : X\n[00:01.00]строка'), '[00:01.00]строка');
});

function neteaseMock({ yrc = '', lrc = '', songs }) {
  const calls = [];
  const getJson = async (url) => {
    calls.push(url);
    if (url.includes('/search/get')) {
      return {
        status: 200,
        json: { result: { songs: songs ?? [{ id: 7, name: 'Редкий трек', artists: [{ name: 'Малоизвестная группа' }], duration: 180500 }] } },
      };
    }
    if (url.includes('/song/lyric/v1')) return { status: 200, json: { yrc: { lyric: yrc }, lrc: { lyric: lrc } } };
    if (url.includes('/song/lyric')) return { status: 200, json: { lrc: { lyric: lrc } } };
    return { status: 404, json: null };
  };
  return { getJson, calls };
}

test('netease prefers word-level YRC', async () => {
  const { getJson } = neteaseMock({ yrc: '[2000,800](2000,400,0)раз (2400,400,0)два', lrc: '[00:02.00]раз два' });
  const res = await netease(TRACK, { getJson });
  assert.equal(res.source, 'NetEase');
  assert.equal(res.wordSync, true);
  assert.match(res.raw, /<00:02.40>два/);
});

test('netease falls back to LRC when no YRC', async () => {
  const { getJson } = neteaseMock({ lrc: '[00:00.00] 作词 : X\n[00:03.00]одна строка' });
  const res = await netease(TRACK, { getJson });
  assert.deepEqual(res, { source: 'NetEase', synced: true, raw: '[00:03.00]одна строка' });
});

test('netease rejects candidates with wrong duration or artist', async () => {
  const { getJson } = neteaseMock({
    lrc: '[00:01.00]x',
    songs: [
      { id: 1, name: 'Редкий трек', artists: [{ name: 'Малоизвестная группа' }], duration: 240000 },
      { id: 2, name: 'Редкий трек', artists: [{ name: 'Совсем другие' }], duration: 181000 },
    ],
  });
  assert.equal(await netease(TRACK, { getJson }), null);
});

test('lyrics.ovh returns plain text', async () => {
  const getJson = async (url) =>
    url.includes('/v1/') ? { status: 200, json: { lyrics: 'Paroles de la chanson X\nпервая\nвторая' } } : { status: 404 };
  const res = await lyricsovh(TRACK, { getJson });
  assert.deepEqual(res, { source: 'lyrics.ovh', synced: false, raw: 'первая\nвторая' });
});

test('finder: synced from a later source beats plain from an earlier one', async () => {
  const getJson = async (url) => {
    if (url.includes('lrclib.net/api/get')) return { status: 200, json: { plainLyrics: 'без таймингов' } };
    if (url.includes('lrclib.net')) return { status: 200, json: [] };
    return neteaseMock({ lrc: '[00:01.00]с таймингами' }).getJson(url);
  };
  const finder = createLyricsFinder({ cache: createCache(memStorage()), getJson });
  const res = await finder.find(TRACK);
  assert.equal(res.source, 'NetEase');
  assert.equal(res.synced, true);
});

test('finder: one failing source does not block the others, plain fallback kept', async () => {
  const getJson = async (url) => {
    if (url.includes('lrclib.net')) throw new Error('offline');
    if (url.includes('music.163.com')) return { status: 200, json: { result: { songs: [] } } };
    if (url.includes('lyrics.ovh')) return { status: 200, json: { lyrics: 'простой текст' } };
    return { status: 404 };
  };
  const finder = createLyricsFinder({ cache: createCache(memStorage()), getJson });
  const res = await finder.find(TRACK);
  assert.equal(res.source, 'lyrics.ovh');
});

// ---------- приоритет таймингов ----------
import { rankOf, RANK } from '../src/renderer/providers/index.js';

function routed({ lrclibRec, neteaseYrc = '', neteaseLrc = '', ovh = '' }) {
  const calls = [];
  const getJson = async (url) => {
    calls.push(url);
    if (url.includes('lrclib.net/api/get')) return lrclibRec ? { status: 200, json: lrclibRec } : { status: 404, json: null };
    if (url.includes('lrclib.net')) return { status: 200, json: [] };
    if (url.includes('music.163.com/api/search'))
      return neteaseYrc || neteaseLrc
        ? { status: 200, json: { result: { songs: [{ id: 9, name: 'Редкий трек', artists: [{ name: 'Малоизвестная группа' }], duration: 181000 }] } } }
        : { status: 200, json: { result: { songs: [] } } };
    if (url.includes('music.163.com')) return { status: 200, json: { yrc: { lyric: neteaseYrc }, lrc: { lyric: neteaseLrc } } };
    if (url.includes('lyrics.ovh')) return ovh ? { status: 200, json: { lyrics: ovh } } : { status: 404 };
    return { status: 404 };
  };
  return { getJson, calls };
}
const finderWith = (getJson) => createLyricsFinder({ cache: createCache(memStorage()), getJson });

test('rankOf orders word > line > plain > instrumental', () => {
  assert.equal(rankOf({ synced: true, raw: '[00:01.00]<00:01.00>а <00:01.50>б' }), RANK.WORD);
  assert.equal(rankOf({ synced: true, wordSync: true, raw: 'x' }), RANK.WORD);
  assert.equal(rankOf({ synced: true, raw: '[00:01.00]а б' }), RANK.LINE);
  assert.equal(rankOf({ synced: false, raw: 'а б' }), RANK.PLAIN);
  assert.equal(rankOf({ instrumental: true, raw: '' }), RANK.INSTRUMENTAL);
  assert.equal(rankOf(null), RANK.NONE);
});

test('word-level timings from NetEase beat line-level from LRCLIB', async () => {
  const { getJson } = routed({ lrclibRec: { syncedLyrics: '[00:01.00]по строкам' }, neteaseYrc: '[1000,900](1000,400,0)по (1400,400,0)словам' });
  const res = await finderWith(getJson).find(TRACK);
  assert.equal(res.source, 'NetEase');
  assert.equal(res.wordSync, true);
});

test('enhanced LRC from LRCLIB is already the best — NetEase is not queried', async () => {
  const { getJson, calls } = routed({ lrclibRec: { syncedLyrics: '[00:01.00]<00:01.00>раз <00:01.40>два' } });
  const res = await finderWith(getJson).find(TRACK);
  assert.equal(res.source, 'LRCLIB');
  assert.equal(res.wordSync, true);
  assert.ok(!calls.some((u) => u.includes('163.com')));
});

test('line-level stays when nobody has word timings; plain-only source is skipped', async () => {
  const { getJson, calls } = routed({ lrclibRec: { syncedLyrics: '[00:01.00]по строкам' }, ovh: 'просто текст' });
  const res = await finderWith(getJson).find(TRACK);
  assert.equal(res.source, 'LRCLIB');
  assert.equal(res.synced, true);
  assert.ok(!calls.some((u) => u.includes('lyrics.ovh')), 'lyrics.ovh cannot improve on synced');
});

test('"instrumental" loses to real lyrics from another source', async () => {
  const { getJson } = routed({ lrclibRec: { instrumental: true }, neteaseLrc: '[00:02.00]всё-таки со словами' });
  const res = await finderWith(getJson).find(TRACK);
  assert.equal(res.source, 'NetEase');
  assert.equal(res.synced, true);
});

test('timed lyrics beat plain text even when plain came first', async () => {
  const { getJson } = routed({ lrclibRec: { plainLyrics: 'без таймингов' }, neteaseLrc: '[00:02.00]с таймингами' });
  const res = await finderWith(getJson).find(TRACK);
  assert.equal(res.source, 'NetEase');
});

test('plain result is shown but not cached when a timed source was down', async () => {
  let down = true;
  const getJson = async (url) => {
    if (url.includes('lrclib.net') && down) throw new Error('offline');
    if (url.includes('lrclib.net/api/get')) return { status: 200, json: { syncedLyrics: '[00:01.00]появились тайминги' } };
    if (url.includes('music.163.com')) return { status: 200, json: { result: { songs: [] } } };
    if (url.includes('lyrics.ovh')) return { status: 200, json: { lyrics: 'просто текст' } };
    return { status: 404 };
  };
  const finder = finderWith(getJson);
  assert.equal((await finder.find(TRACK)).source, 'lyrics.ovh');
  down = false;
  const again = await finder.find(TRACK);
  assert.equal(again.source, 'LRCLIB', 'retried instead of serving cached plain text');
  assert.equal(again.synced, true);
});
