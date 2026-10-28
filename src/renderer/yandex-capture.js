// Ловит ответы приложения на /tracks/{id}/lyrics (fetch и XHR) и скачивает LRC по downloadUrl.

import { LYRICS_URL, extractDownloadUrl } from './providers/yandex.js';

export function installYandexCapture(onLyrics) {
  const handle = async (url, readJson) => {
    if (!LYRICS_URL.test(url)) return;
    try {
      const downloadUrl = extractDownloadUrl(await readJson());
      if (downloadUrl) onLyrics(downloadUrl);
    } catch {}
  };

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const p = origFetch.apply(this, arguments);
    const url = typeof input === 'string' ? input : input?.url || String(input);
    if (LYRICS_URL.test(url)) p.then((r) => handle(url, () => r.clone().json())).catch(() => {});
    return p;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    const u = String(url);
    if (LYRICS_URL.test(u)) {
      this.addEventListener('load', () =>
        handle(u, async () => (this.responseType === 'json' ? this.response : JSON.parse(this.responseText))),
      );
    }
    return origOpen.apply(this, arguments);
  };
}
