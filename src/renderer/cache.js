// Кэш найденных текстов в localStorage. Отрицательные результаты живут ограниченное время.

const KEY = 'ymlyrics:cache:v3'; // v3: сброс «не найдено», закэшированных из-за длительности предыдущего трека
export const NEGATIVE_TTL = 24 * 3600 * 1000;

export function createCache(storage, { max = 200, now = () => Date.now() } = {}) {
  let data = {};
  try {
    data = JSON.parse(storage.getItem(KEY) || '{}') || {};
  } catch {
    data = {};
  }
  let timer = null;

  const persist = () => {
    clearTimeout(timer);
    timer = setTimeout(flush, 300);
  };
  const flush = () => {
    const keys = Object.keys(data);
    if (keys.length > max) {
      keys.sort((a, b) => data[a].at - data[b].at);
      for (const k of keys.slice(0, keys.length - max)) delete data[k];
    }
    try {
      storage.setItem(KEY, JSON.stringify(data));
    } catch {
      // переполнение — выкидываем половину старых записей
      const ks = Object.keys(data).sort((a, b) => data[a].at - data[b].at);
      for (const k of ks.slice(0, ks.length >> 1)) delete data[k];
      try {
        storage.setItem(KEY, JSON.stringify(data));
      } catch {}
    }
  };

  return {
    get(key) {
      const e = data[key];
      if (!e) return undefined;
      if (!e.value && now() - e.at > NEGATIVE_TTL) {
        delete data[key];
        return undefined;
      }
      return e.value; // null = «не найдено»
    },
    set(key, value) {
      data[key] = { at: now(), value: value ?? null };
      persist();
    },
    delete(key) {
      delete data[key];
      persist();
    },
    flush,
  };
}
