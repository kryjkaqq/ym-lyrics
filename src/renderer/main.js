// Точка входа мода. Подключается первым <script> в <head>: хуки плеера и сети ставятся
// до загрузки кода приложения, интерфейс — после DOMContentLoaded.

import css from './ui/lyrics.css';
import fontsCss from './ui/fonts.css';
import themeCss from './ui/app-theme.css';
import { installAppTheme } from './app-theme.js';
import { createPlayerBridge } from './player-bridge.js';
import { installYandexCapture } from './yandex-capture.js';
import { rememberYandexLyrics, onYandexLyrics } from './providers/yandex.js';
import { createLyricsFinder } from './providers/index.js';
import { createCache } from './cache.js';
import { createSettings } from './settings.js';
import { getJson, httpGet } from './net.js';
import { createOverlay } from './ui/overlay.js';
import { installAudioTap } from './audio-tap.js';
import { createTempoHints } from './tempo-hint.js';

const VERSION = '1.7.1';

if (!window.__ymLyrics && window === window.top) {
  window.__ymLyrics = { version: VERSION };
  boot();
}

// короткий отчёт о странице в лог — чтобы чинить вид без доступа к DevTools
function diagnose() {
  const log = window.ymLyricsNative?.log;
  if (!log) return;
  const cs = (el, ...props) => (el ? props.map((p) => `${p}=${getComputedStyle(el).getPropertyValue(p).trim()}`).join(' ') : 'нет');
  const desc = (el) => (el ? `<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 120)}">` : 'нет');
  const dark = document.querySelector('.ym-dark-theme');
  const nav = document.querySelector('nav, aside, [class*="Navbar"]');
  const lines = [
    `version ${VERSION}`,
    `html: ${desc(document.documentElement)} | body: ${desc(document.body)}`,
    `.ym-dark-theme: ${desc(dark)} | .ym-light-theme: ${desc(document.querySelector('.ym-light-theme'))}`,
    `html vars: ${cs(document.documentElement, '--ym-background-color-primary-enabled-basic', '--ym-controls-color-primary-default-enabled', '--ylt-accent')}`,
    `body: ${cs(document.body, 'background-color', '--ym-background-color-primary-enabled-basic')}`,
    `nav: ${desc(nav)} ${cs(nav, 'background-color', 'background-image')}`,
    `ambient: ${cs(document.getElementById('ylt-ambient'), 'display', 'z-index')} | layers: ${[...document.querySelectorAll('#ylt-ambient .ylt-layer')].map((l) => `${l.className}:${l.style.backgroundImage.slice(0, 80)}`).join(' ; ')}`,
    `meta artwork: ${(window.__ymLyricsPlayer?.meta?.artwork || '').slice(0, 100)}`,
    `style tag: ${!!document.getElementById('ym-lyrics-style')} | fab: ${!!document.querySelector('.yl-fab')}`,
    `top-level: ${[...document.body.children].map(desc).join(' ')}`,
  ];
  log(lines.join(String.fromCharCode(10)));
}

function boot() {
  const player = createPlayerBridge();
  window.__ymLyricsPlayer = player;
  const tap = installAudioTap();
  const finder = createLyricsFinder({ cache: createCache(localStorage), getJson });
  const settings = createSettings();
  const tempo = createTempoHints({ getJson });

  installYandexCapture(async (downloadUrl) => {
    const m = player.meta;
    if (!m) return;
    try {
      const { status, text } = await httpGet(downloadUrl);
      if (status === 200 && text) rememberYandexLyrics(finder.keyOf(m), text);
    } catch (e) {
      console.warn('[ym-lyrics] yandex lyrics download failed', e);
    }
  });

  const start = () => {
    const style = document.createElement('style');
    style.id = 'ym-lyrics-style';
    setInterval(() => !style.isConnected && document.head.append(style), 1000);
    style.textContent = fontsCss + css + themeCss;
    document.head.append(style);

    let current = null;
    let lastResult = null;

    const load = async (force = false) => {
      const m = player.meta;
      if (!m) return;
      const sig = finder.keyOf(m);
      current = sig;
      overlay.setTrack(m);
      // темп из базы Deezer — подсказка анализатору бита, приходит параллельно с поиском текста
      tempo.get({ ...m, duration: player.duration() || undefined }).then((bpm) => {
        if (current === sig && bpm) overlay.setTempoHint(bpm);
      });
      // дождаться длительности — она нужна для точного поиска
      for (let i = 0; i < 10 && !player.duration(); i++) await new Promise((r) => setTimeout(r, 150));
      const track = { ...m, duration: player.duration() || undefined };
      let res = await finder.find(track, { force });
      if (current !== sig) return;
      // пусто — источники могли не ответить в первые секунды трека; одна повторная попытка, пока висит «Ищу текст…»
      if (!res && !force) {
        await new Promise((r) => setTimeout(r, 2500));
        if (current !== sig) return;
        res = await finder.find({ ...m, duration: player.duration() || undefined }, { force: true });
        if (current !== sig) return;
      }
      lastResult = res;
      overlay.setResult(res);
    };

    installAppTheme({ player, settings });
    const overlay = createOverlay({ player, settings, tap, onRetry: () => load(true) });

    player.onTrack(() => load());
    onYandexLyrics((key) => {
      // приложение получило свой синхронный текст — он точнее, перезагружаем, если у нас хуже
      if (player.meta && key === finder.keyOf(player.meta) && !(lastResult?.synced && lastResult.source === 'Яндекс Музыка')) {
        load(true);
      }
    });

    window.__ymLyrics.toggle = overlay.toggle;
    window.__ymLyrics.reload = () => load(true);
    setTimeout(diagnose, 6000);
    console.info(`[ym-lyrics] v${VERSION} ready — нажми L или кнопку «Текст»`);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
