const KEY = 'ymlyrics:settings:v1';

export const STYLES = [
  { id: 'fill', name: 'Заливка' },
  { id: 'bounce', name: 'Прыжок' },
  { id: 'glow', name: 'Свечение' },
  { id: 'typewriter', name: 'Появление' },
];

export const VISUALIZERS = [
  { id: 'ring', name: 'Кольцо' },
  { id: 'bars', name: 'Полосы' },
  { id: 'wave', name: 'Волны' },
  { id: 'aura', name: 'Аура' },
  { id: 'ripples', name: 'Круги' },
  { id: 'warp', name: 'Тоннель' },
  { id: 'led', name: 'Пиксели' },
  { id: 'off', name: 'Выкл' },
];

export const ALIGNS = [
  { id: 'left', name: 'Слева' },
  { id: 'center', name: 'По центру' },
];

export const WEIGHTS = [
  { id: 600, name: 'Обычный' },
  { id: 700, name: 'Жирный' },
  { id: 800, name: 'Очень жирный' },
];

export const PARTICLES = [
  { id: 'off', name: 'Выкл', count: 0 },
  { id: 'few', name: 'Мало', count: 40 },
  { id: 'normal', name: 'Средне', count: 90 },
  { id: 'many', name: 'Много', count: 160 },
];

export const FPS = [
  { id: 30, name: '30 к/с — экономно' },
  { id: 60, name: '60 к/с — плавно' },
];

// акцент: из обложки или свой (пара цветов для градиентов)
export const ACCENTS = [
  { id: 'auto', name: 'Из обложки' },
  { id: 'pink', name: 'Розовый', c: ['#ff5fa2', '#ff9a5a'] },
  { id: 'violet', name: 'Фиолетовый', c: ['#a78bfa', '#f472b6'] },
  { id: 'blue', name: 'Голубой', c: ['#5ab8ff', '#7c8cff'] },
  { id: 'mint', name: 'Мятный', c: ['#4fe0b0', '#5ab8ff'] },
  { id: 'amber', name: 'Янтарный', c: ['#ffb347', '#ff6a3d'] },
  { id: 'white', name: 'Белый', c: ['#f4f4f5', '#c7c7d1'] },
];

// шрифт текста песни: все с кириллицей и латиницей (вшиты в мод, кроме системного шрифта приложения)
export const FONTS = [
  { id: 'ys', name: 'Яндекс', family: "'YL Text', 'YS Text'" },
  // широкие и жирные
  { id: 'unbounded', name: 'Unbounded', family: "'Unbounded'" },
  { id: 'russo', name: 'Russo One', family: "'Russo One'" },
  { id: 'dela', name: 'Dela Gothic', family: "'Dela Gothic One'" },
  { id: 'rubikmono', name: 'Rubik Mono', family: "'Rubik Mono One'", scale: 0.86 },
  { id: 'daysone', name: 'Days One', family: "'Days One'" },
  { id: 'tektur', name: 'Tektur', family: "'Tektur'" },
  // с засечками
  { id: 'lora', name: 'Lora', family: "'Lora'" },
  { id: 'ptserif', name: 'PT Serif', family: "'PT Serif'" },
  { id: 'prata', name: 'Prata', family: "'Prata'" },
  { id: 'cormorant', name: 'Cormorant', family: "'Cormorant Garamond'", scale: 1.1 },
  { id: 'playfair', name: 'Playfair', family: "'Playfair Display'" },
  // тонкие
  { id: 'manrope', name: 'Manrope', family: "'Manrope'" },
  { id: 'comfortaa', name: 'Comfortaa', family: "'Comfortaa'" },
  // пиксельные
  { id: 'pixelify', name: 'Pixelify', family: "'Pixelify Sans'" },
  { id: 'pressstart', name: 'Press Start', family: "'Press Start 2P'", scale: 0.62 },
];

export const LAYOUTS = [
  { id: 'split', name: 'Обложка сбоку' },
  { id: 'center', name: 'По центру' },
];

const DEFAULTS = {
  visualizer: 'ring',
  layout: 'split',
  particles: true, // старый переключатель — оставлен для совместимости
  particlesAmount: 'normal',
  beatPulse: true,
  intensity: 1, // сила спектра
  punch: 1, // толчок в бит
  glow: 1, // свечение в бит
  align: 'left',
  weight: 800,
  font: 'ys',
  appTheme: true, // тема всего приложения из обложки
  bgDim: 0, // затемнение фона 0..0.6
  accent: 'auto',
  fps: 60,
  style: 'fill',
  fontSize: 46,
  offset: 0, // сек, + = текст раньше
  background: true,
  blurInactive: true,
};

export function createSettings(storage = localStorage) {
  let s = { ...DEFAULTS };
  try {
    Object.assign(s, JSON.parse(storage.getItem(KEY) || '{}'));
    if (s.particles === false && !('particlesAmount' in JSON.parse(storage.getItem(KEY) || '{}'))) s.particlesAmount = 'off';
  } catch {}
  const listeners = new Set();
  return {
    get: () => s,
    set(patch) {
      s = { ...s, ...patch };
      try {
        storage.setItem(KEY, JSON.stringify(s));
      } catch {}
      for (const fn of listeners) fn(s);
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
