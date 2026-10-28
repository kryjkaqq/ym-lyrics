
/* ym-lyrics:main */
;(() => {
  try {
    const { ipcMain, net, app, BrowserWindow, desktopCapturer, session } = require('electron');
    const fromApp = (url) => String(url || '').startsWith('music-application://desktop');
    // только GET и только к источникам текстов — мост не превращается в универсальный прокси
    const ALLOWED = [/^lrclib\.net$/, /^music\.163\.com$/, /^api\.lyrics\.ovh$/, /(^|\.)yandex\.net$/, /(^|\.)yandex\.ru$/, /(^|\.)yastatic\.net$/, /^api\.deezer\.com$/];
    app.whenReady().then(() => {
      ipcMain.handle('ym-lyrics:get', async (event, url) => {
        if (!fromApp(event.senderFrame?.url)) throw new Error('forbidden');
        const u = new URL(url);
        if (u.protocol !== 'https:' || !ALLOWED.some((re) => re.test(u.hostname))) throw new Error('host not allowed');
        const res = await net.fetch(u.toString(), {
          headers: u.hostname === 'music.163.com'
            ? { Referer: 'https://music.163.com/', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36' }
            : { 'User-Agent': 'ym-lyrics/1.1 (Yandex Music desktop mod)' },
          credentials: 'omit',
        });
        return { status: res.status, text: await res.text() };
      });
      // полный экран окна; want: true/false — включить/выключить, null — просто узнать состояние
      ipcMain.handle('ym-lyrics:fullscreen', (event, want) => {
        if (!fromApp(event.senderFrame?.url)) throw new Error('forbidden');
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) return false;
        if (typeof want === 'boolean' && want !== win.isFullScreen()) win.setFullScreen(want);
        return typeof want === 'boolean' ? want : win.isFullScreen();
      });
      // диагностика мода — в файл ym-lyrics.log в папке данных приложения (перезаписывается при запуске)
      const logFile = require('path').join(app.getPath('userData'), 'ym-lyrics.log');
      try { require('fs').writeFileSync(logFile, ''); } catch {}
      ipcMain.handle('ym-lyrics:log', (event, text) => {
        if (!fromApp(event.senderFrame?.url)) throw new Error('forbidden');
        require('fs').appendFileSync(logFile, `[${new Date().toISOString()}] ${String(text).slice(0, 20000)}
`);
      });
      // свернуть окно — в полноэкранном режиме у приложения нет своей кнопки
      ipcMain.handle('ym-lyrics:minimize', (event) => {
        if (!fromApp(event.senderFrame?.url)) throw new Error('forbidden');
        BrowserWindow.fromWebContents(event.sender)?.minimize();
      });
      // системный звук для визуализатора: getDisplayMedia из окна приложения получает loopback без диалога.
      // Видео нужно Chromium формально — рендерер сразу останавливает эту дорожку.
      const allowLoopback = (ses) => {
        try {
          ses.setDisplayMediaRequestHandler((request, callback) => {
            if (!fromApp(request.frame?.url) || !request.audioRequested) return callback({});
            desktopCapturer
              .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
              .then((sources) => callback(sources[0] ? { video: sources[0], audio: 'loopback' } : {}))
              .catch(() => callback({}));
          });
        } catch (e) {
          console.warn('[ym-lyrics] loopback handler failed', e);
        }
      };
      allowLoopback(session.defaultSession);
      app.on('web-contents-created', (_, wc) => {
        if (wc.session !== session.defaultSession && !wc.session.__ymLyricsLoopback) {
          wc.session.__ymLyricsLoopback = true;
          allowLoopback(wc.session);
        }
      });
      // обложка как data URL — чтобы прочитать её пиксели для палитры, даже если CDN не отдаёт CORS
      ipcMain.handle('ym-lyrics:image', async (event, url) => {
        if (!fromApp(event.senderFrame?.url)) throw new Error('forbidden');
        const u = new URL(url);
        if (u.protocol !== 'https:' || !/(^|\.)(yandex\.net|yandex\.ru|yastatic\.net)$/.test(u.hostname)) throw new Error('host not allowed');
        const res = await net.fetch(u.toString(), { credentials: 'omit' });
        const type = res.headers.get('content-type') || '';
        if (!res.ok || !/^image\//.test(type)) throw new Error('not an image');
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 5 * 1024 * 1024) throw new Error('image too large');
        return `data:${type};base64,${buf.toString('base64')}`;
      });
    });
  } catch (e) {
    console.warn('[ym-lyrics] main hook failed', e);
  }
})();
