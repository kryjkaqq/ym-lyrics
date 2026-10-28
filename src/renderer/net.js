// HTTP через main-процесс (net.fetch, без CORS) — мост ymLyricsNative добавляет патч preload.js.
// Если моста нет (например, отладка в браузере) — обычный fetch.

export async function httpGet(url) {
  const native = window.ymLyricsNative;
  if (native?.get) return native.get(url);
  const r = await fetch(url, { credentials: 'omit' });
  return { status: r.status, text: await r.text() };
}

export async function getJson(url) {
  const { status, text } = await httpGet(url);
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { status, json };
}
