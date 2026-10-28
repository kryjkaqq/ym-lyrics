import { build } from 'esbuild';
import { mkdir, copyFile, cp } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/renderer/main.js'],
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  minify: process.argv.includes('--minify'),
  loader: { '.css': 'text' },
  outfile: 'dist/ym-lyrics.js',
  banner: { js: '/* ym-lyrics — synced lyrics mod for Yandex Music desktop */' },
  logLevel: 'info',
});
await copyFile('src/inject/preload-hook.js', 'dist/preload-hook.js');
await copyFile('src/inject/main-hook.js', 'dist/main-hook.js');
await cp('fonts', 'dist/fonts', { recursive: true }); // шрифты для выбора в настройках
