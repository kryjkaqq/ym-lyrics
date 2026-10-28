// Фон из обложки: два слоя размытой обложки с плавной сменой + полная палитра темы,
// которая через CSS-переменные расходится по всему интерфейсу.

import { extractPalette, DEFAULT_PALETTE } from '../palette.js';

const VARS = ['accent', 'accent2', 'base', 'baseDeep', 'ink', 'dim', 'soft', 'glow', 'onInk'];
const cssName = (k) => `--yl-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

export function applyPalette(root, p) {
  for (const k of VARS) root.style.setProperty(cssName(k), p[k]);
  root.classList.toggle('is-mono', p.mono);
}

export function createBackground(root, { onPalette } = {}) {
  const bg = document.createElement('div');
  bg.className = 'yl-bg';
  bg.innerHTML =
    '<div class="yl-bg-stack is-current"><div class="yl-bg-layer a"></div><div class="yl-bg-layer b"></div></div>' +
    '<div class="yl-bg-stack"><div class="yl-bg-layer a"></div><div class="yl-bg-layer b"></div></div>' +
    '<div class="yl-bg-tint"></div><div class="yl-bg-glow"></div><div class="yl-grain"></div>';
  root.prepend(bg);
  const stacks = [...bg.querySelectorAll('.yl-bg-stack')];
  let front = 0;
  let current = null;

  applyPalette(root, DEFAULT_PALETTE);
  onPalette?.(DEFAULT_PALETTE);

  return {
    el: bg,
    glow: bg.querySelector('.yl-bg-glow'),
    async setCover(url) {
      if (url === current) return;
      current = url;
      // новая обложка проявляется поверх старой, а не подменяет её резко
      front = 1 - front;
      // фон всё равно размыт — маленькая обложка экономит память на декодировании
      const small = smallCover(url);
      for (const l of stacks[front].children) l.style.backgroundImage = small ? `url("${small}")` : '';
      stacks[front].classList.add('is-current');
      stacks[1 - front].classList.remove('is-current');
      const p = url
        ? await paletteFromImage(url).catch((e) => {
            console.warn('[ym-lyrics] palette failed, using default', e);
            return DEFAULT_PALETTE;
          })
        : DEFAULT_PALETTE;
      if (current !== url) return;
      applyPalette(root, p);
      onPalette?.(p);
    },
  };
}

// обложки Яндекса: .../800x800 → .../400x400
export function smallCover(url) {
  return url ? url.replace(/\/\d+x\d+(?=$|\?)/, '/400x400') : '';
}

// сначала обычная загрузка с CORS; если CDN её не разрешает — через main-процесс как data URL
export async function paletteFromImage(url) {
  try {
    return await paletteFromSrc(url);
  } catch (e) {
    const native = window.ymLyricsNative;
    if (!native?.image || url.startsWith('data:')) throw e;
    return paletteFromSrc(await native.image(url));
  }
}

function paletteFromSrc(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 32;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, 32, 32);
        resolve(extractPalette(ctx.getImageData(0, 0, 32, 32).data));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = reject;
    img.src = url;
  });
}
