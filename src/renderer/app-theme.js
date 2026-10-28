// Тема всего приложения: фон окна из размытой текущей обложки, стеклянные панели и акцент из обложки
// вместо жёлтого. Работает через CSS-переменные темы самой Яндекс Музыки (--ym-*), разметку не трогает.
// Только для тёмной темы приложения; фон статичный — анимаций и нагрузки нет.

import { paletteFromImage, smallCover } from './ui/background.js';

export function installAppTheme({ player, settings }) {
  const html = document.documentElement;
  const amb = document.createElement('div');
  amb.id = 'ylt-ambient';
  amb.innerHTML = '<div class="ylt-layer"></div><div class="ylt-layer"></div>';
  // в конец body: элемент в начале ломает гидратацию React, и тот перерисовывает всю страницу
  document.body.append(amb);
  const layers = [...amb.children];
  let front = 0;
  let shown = '';

  async function setCover(url) {
    if (!settings.get().appTheme || !url || url === shown) return;
    shown = url;
    // новая обложка проявляется поверх старой
    front = 1 - front;
    layers[front].style.backgroundImage = `url("${smallCover(url)}")`;
    layers[front].classList.add('is-on');
    layers[1 - front].classList.remove('is-on');
    try {
      const p = await paletteFromImage(url);
      if (shown !== url) return;
      html.style.setProperty('--ylt-accent', p.accent);
      html.style.setProperty('--ylt-accent2', p.accent2);
    } catch (e) {
      console.warn('[ym-lyrics] app theme palette failed', e);
      window.ymLyricsNative?.log?.(`app theme palette failed: ${e?.message || e} (${url})`);
    }
  }

  const sync = () => setCover(player.meta?.artwork || '');
  function apply(s) {
    html.classList.toggle('ylt', !!s.appTheme);
    if (s.appTheme) sync();
    else shown = '';
  }
  // React приложения может пересобрать <body> и сбросить класс <html> — возвращаем своё
  function ensure() {
    if (!amb.isConnected) document.body.append(amb);
    html.classList.toggle('ylt', !!settings.get().appTheme);
  }
  setInterval(ensure, 1000);
  apply(settings.get());
  settings.onChange(apply);
  player.onTrack(sync);
  // обложка в метаданных иногда появляется позже названия трека
  setInterval(sync, 2000);
}
