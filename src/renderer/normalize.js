// Нормализация названий для поиска текстов и ключей кэша.

const FEAT = /\s*[([]?\s*(?:feat\.?|ft\.?|featuring|при уч\.?|при участии)\s+[^)\]]*[)\]]?/gi;
const BRACKETS = /\s*[([][^)\]]*[)\]]/g;
const DASH_SUFFIX = /\s+[-–—]\s+.*(?:remaster|version|edit|mix|live|mono|stereo|версия|ремастер).*$/i;

export function fold(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function primaryArtist(artist) {
  return String(artist ?? '')
    .split(/\s*(?:,|&|;| x | feat\.? | ft\.? | и )\s*/i)[0]
    .trim();
}

export function titleVariants(title) {
  const t = String(title ?? '').trim();
  const noFeat = t.replace(FEAT, '').trim();
  const noBrackets = noFeat.replace(BRACKETS, '').trim();
  const noSuffix = noBrackets.replace(DASH_SUFFIX, '').trim();
  return [...new Set([t, noFeat, noBrackets, noSuffix].filter(Boolean))];
}

// длительность в ключ не входит: округление на границе давало бы разные ключи для одного трека
export function trackKey(track) {
  return `${fold(primaryArtist(track.artist))}|${fold(String(track.title ?? '').replace(FEAT, ''))}`;
}

const RU = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };

export function translit(s) {
  return String(s ?? '').replace(/[а-яё]/gi, (c) => {
    const r = RU[c.toLowerCase()] ?? c;
    return c === c.toLowerCase() ? r : r.charAt(0).toUpperCase() + r.slice(1);
  });
}

export function hasCyrillic(s) {
  return /[а-яё]/i.test(String(s ?? ''));
}

// похожесть названий 0..1 по пересечению слов
export function similarity(a, b) {
  const A = new Set(fold(a).split(' ').filter(Boolean));
  const B = new Set(fold(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return (2 * common) / (A.size + B.size);
}
