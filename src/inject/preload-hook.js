
/* ym-lyrics:preload */
;(() => {
  try {
    if (window !== window.top) return;
    if (!String(window.location.href).startsWith('music-application://desktop')) return;
    require('electron').contextBridge.exposeInMainWorld('ymLyricsNative', {
      get: (url) => require('electron').ipcRenderer.invoke('ym-lyrics:get', String(url)),
      image: (url) => require('electron').ipcRenderer.invoke('ym-lyrics:image', String(url)),
      log: (text) => require('electron').ipcRenderer.invoke('ym-lyrics:log', String(text)),
      minimize: () => require('electron').ipcRenderer.invoke('ym-lyrics:minimize'),
      fullscreen: (want) => require('electron').ipcRenderer.invoke('ym-lyrics:fullscreen', typeof want === 'boolean' ? want : null),
    });
  } catch (e) {
    console.warn('[ym-lyrics] preload hook failed', e);
  }
})();
