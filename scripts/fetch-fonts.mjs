// Скачивает шрифты с кириллицей и латиницей из Google Fonts (лицензия OFL) в fonts/
// и собирает src/renderer/ui/fonts.css. Запуск: node scripts/fetch-fonts.mjs
import { mkdir, writeFile, rm } from 'node:fs/promises';

export const FONTS = [
  // широкие и жирные
  ['Unbounded', 'wght@200..900'],
  ['Russo One', ''],
  ['Dela Gothic One', ''],
  ['Rubik Mono One', ''],
  ['Days One', ''],
  ['Tektur', 'wght@400..900'],
  // с засечками
  ['Lora', 'wght@400..700'],
  ['PT Serif', 'wght@400;700'],
  ['Prata', ''],
  ['Cormorant Garamond', 'wght@300..700'],
  ['Playfair Display', 'wght@400..900'],
  // тонкие
  ['Manrope', 'wght@200..800'],
  ['Comfortaa', 'wght@300..700'],
  // пиксельные
  ['Pixelify Sans', 'wght@400..700'],
  ['Press Start 2P', ''],
];
const SUBSETS = new Set(['cyrillic', 'cyrillic-ext', 'latin', 'latin-ext']);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

await rm('fonts', { recursive: true, force: true });
await mkdir('fonts', { recursive: true });
let css = '/* сгенерировано scripts/fetch-fonts.mjs — шрифты Google Fonts, лицензия SIL OFL 1.1 */\n';
let total = 0;
for (const [family, axes] of FONTS) {
  const q = family.replace(/ /g, '+') + (axes ? `:${axes}` : '');
  const res = await fetch(`https://fonts.googleapis.com/css2?family=${q}&display=swap`, { headers: { 'User-Agent': UA } });
  const text = await res.text();
  const blocks = [...text.matchAll(/\/\* ([a-z-]+) \*\/\s*(@font-face \{[^}]+\})/g)];
  for (const [, subset, block] of blocks) {
    if (!SUBSETS.has(subset)) continue;
    const url = block.match(/url\((https:[^)]+\.woff2)\)/)[1];
    const file = `${family.replace(/ /g, '')}-${subset}.woff2`;
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    await writeFile(`fonts/${file}`, buf);
    total += buf.length;
    css += block.replace(/url\([^)]+\)/, `url('/ym-lyrics-fonts/${file}')`) + '\n';
  }
  console.log(family, 'ok');
}
await writeFile('src/renderer/ui/fonts.css', css);
console.log(`готово: ${(total / 1024).toFixed(0)} КБ`);
