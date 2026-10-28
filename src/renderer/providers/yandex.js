// Тексты самой Яндекс Музыки. Запрос к /tracks/{id}/lyrics подписывается ключом приложения,
// поэтому мод не делает его сам, а перехватывает ответы, которые приложение уже получило
// (например, когда открыта встроенная «текстомузыка»), и запоминает их для текущего трека.

const store = new Map();
const listeners = new Set();

export function rememberYandexLyrics(key, raw) {
  if (!key || !raw) return;
  store.set(key, raw);
  for (const fn of listeners) fn(key);
}

export function onYandexLyrics(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function yandex(track, { key }) {
  const raw = store.get(key);
  return raw ? { source: 'Яндекс Музыка', synced: true, raw } : null;
}

// URL вида .../tracks/12345/lyrics?... — ответ содержит downloadUrl с LRC-файлом
export const LYRICS_URL = /\/tracks\/(\d+)(?::\d+)?\/lyrics(?:\?|$)/;

export function extractDownloadUrl(json) {
  return json?.result?.downloadUrl ?? json?.downloadUrl ?? null;
}
