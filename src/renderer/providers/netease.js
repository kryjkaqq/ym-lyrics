// NetEase Cloud Music — большой каталог, в том числе редкие и азиатские треки.
// Отдаёт LRC, а для части треков ещё и YRC — тайминги по каждому слову.

import { primaryArtist, titleVariants, translit, hasCyrillic } from '../normalize.js';
import { pickBy } from './match.js';

const API = 'https://music.163.com/api';

// служебные строки в начале текстов NetEase: авторы, аранжировщики и т.п.
const CREDIT = /^\s*(作词|作曲|编曲|制作人|混音|母带|和声|吉他|贝斯|鼓|录音|监制|出品|统筹|企划|词|曲|lyrics?|composer|arranger|producer|written by)\s*[:：]/i;

const pad = (n, w = 2) => String(n).padStart(w, '0');
export function msToTag(ms) {
  const cs = Math.floor(Math.max(0, ms) / 10); // целые сотые — без ошибок округления
  const m = Math.floor(cs / 6000);
  return `${pad(m)}:${pad(Math.floor(cs / 100) % 60)}.${pad(cs % 100)}`;
}

// YRC: "[startMs,durMs](wStart,wDur,0)слово(wStart,wDur,0)слово" → enhanced LRC
export function yrcToLrc(yrc) {
  const out = [];
  for (const line of String(yrc || '').split('\n')) {
    const head = line.match(/^\[(\d+),(\d+)\]/);
    if (!head) continue; // строки-метаданные в JSON и пустые
    const parts = [...line.slice(head[0].length).matchAll(/\((\d+),(\d+),\d+\)([^(]*)/g)];
    if (!parts.length) continue;
    const text = parts.map((p) => p[3]).join('');
    if (CREDIT.test(text)) continue;
    out.push(`[${msToTag(+head[1])}]` + parts.map((p) => `<${msToTag(+p[1])}>${p[3]}`).join(''));
  }
  return out.join('\n');
}

export function cleanLrc(lrc) {
  return String(lrc || '')
    .split('\n')
    .filter((l) => !CREDIT.test(l.replace(/^(\[[^\]]*\])+/, '')))
    .join('\n');
}

const toCandidate = (s) => ({
  title: s.name,
  artist: (s.artists || s.ar || []).map((a) => a.name).join(', '),
  duration: (s.duration ?? s.dt ?? 0) / 1000,
});

async function search(getJson, q) {
  const res = await getJson(`${API}/search/get?s=${encodeURIComponent(q)}&type=1&limit=15&offset=0`);
  return res.status === 200 ? res.json?.result?.songs || [] : [];
}

export async function netease(track, { getJson }) {
  const artist = primaryArtist(track.artist);
  const title = titleVariants(track.title).at(-1);
  const queries = [`${artist} ${title}`, title];
  if (hasCyrillic(artist) || hasCyrillic(title)) queries.push(`${translit(artist)} ${translit(title)}`);

  let song = null;
  for (const q of queries) {
    song = pickBy(await search(getJson, q), track, toCandidate);
    if (song) break;
  }
  if (!song) return null;

  // сначала пробуем тайминги по словам, потом обычный LRC
  const v1 = await getJson(`${API}/song/lyric/v1?id=${song.id}&lv=1&yv=1&tv=0`);
  const yrc = v1.status === 200 ? yrcToLrc(v1.json?.yrc?.lyric) : '';
  if (yrc) return { source: 'NetEase', synced: true, wordSync: true, raw: yrc };

  const lrcJson = v1.status === 200 && v1.json?.lrc ? v1.json : (await getJson(`${API}/song/lyric?id=${song.id}&lv=1&tv=-1`)).json;
  if (lrcJson?.nolyric) return { source: 'NetEase', instrumental: true, synced: false, raw: '' };
  const lrc = cleanLrc(lrcJson?.lrc?.lyric);
  if (!lrc.trim()) return null;
  const synced = /\[\d{1,3}:\d{1,2}/.test(lrc);
  return { source: 'NetEase', synced, raw: lrc };
}
