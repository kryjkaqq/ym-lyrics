// lyrics.ovh — простой открытый API, только текст без таймингов. Последний запасной вариант.

import { primaryArtist, titleVariants } from '../normalize.js';

export async function lyricsovh(track, { getJson }) {
  const artist = primaryArtist(track.artist);
  for (const title of [...new Set([titleVariants(track.title).at(-1), track.title])]) {
    const res = await getJson(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`);
    const text = res.status === 200 ? String(res.json?.lyrics || '').trim() : '';
    // первая строка у lyrics.ovh иногда служебная: "Paroles de la chanson ..."
    if (text) return { source: 'lyrics.ovh', synced: false, raw: text.replace(/^Paroles de la chanson.*\r?\n/i, '') };
  }
  return null;
}
