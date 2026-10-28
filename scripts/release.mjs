// Собирает готовый к раздаче архив release/ym-lyrics-vX.Y.Z.zip:
//   Установить.bat / Удалить.bat — двойной клик, ничего собирать не нужно;
//   installer.mjs — установщик одним файлом (с @electron/asar внутри);
//   app/ — собранный мод и шрифты.
// Если на компьютере нет Node.js 18+, .bat один раз скачивает портативный Node в %LOCALAPPDATA%\ym-lyrics.
// Запуск: node scripts/release.mjs

import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const version = (await readFile('src/renderer/main.js', 'utf8')).match(/const VERSION = '([^']+)'/)[1];
const OUT = 'release/ym-lyrics';
const ZIP = `release/ym-lyrics-v${version}.zip`;
const NODE_VERSION = 'v22.12.0';

execFileSync(process.execPath, ['build.mjs', '--minify'], { stdio: 'inherit' });
await rm('release', { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

await build({
  entryPoints: ['patcher/patch.mjs'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile: `${OUT}/installer.mjs`,
  // часть зависимостей asar — CommonJS; даём им require внутри ESM-бандла
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
});
await cp('dist', `${OUT}/app`, { recursive: true });

// .bat: поиск Node 18+, иначе — портативный Node (один раз), затем установщик
const findNode = `set "NODE="
where node >nul 2>nul && node -e "process.exit(+process.versions.node.split('.')[0]>=18?0:1)" && set "NODE=node"
if not defined NODE if exist "%LOCALAPPDATA%\\ym-lyrics\\node\\node.exe" set "NODE=%LOCALAPPDATA%\\ym-lyrics\\node\\node.exe"
if not defined NODE (
  echo Node.js не найден - скачиваю портативную версию один раз ^(~30 МБ^)...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol='Tls12'; $v='${NODE_VERSION}'; $d=Join-Path $env:LOCALAPPDATA 'ym-lyrics'; New-Item -ItemType Directory -Force $d | Out-Null; $z=Join-Path $env:TEMP 'ym-lyrics-node.zip'; Invoke-WebRequest \\"https://nodejs.org/dist/$v/node-$v-win-x64.zip\\" -OutFile $z -UseBasicParsing; Expand-Archive $z $d -Force; Remove-Item $z; if (Test-Path (Join-Path $d 'node')) { Remove-Item (Join-Path $d 'node') -Recurse -Force }; Rename-Item (Join-Path $d \\"node-$v-win-x64\\") 'node'"
  if exist "%LOCALAPPDATA%\\ym-lyrics\\node\\node.exe" set "NODE=%LOCALAPPDATA%\\ym-lyrics\\node\\node.exe"
)
if not defined NODE (
  echo Не удалось получить Node.js. Установи его с https://nodejs.org и запусти этот файл ещё раз.
  pause
  exit /b 1
)`;

const bat = (action, done) => `@echo off
chcp 65001 >nul
cd /d "%~dp0"
${findNode}
"%NODE%" installer.mjs ${action}
if errorlevel 1 (
  echo.
  echo Не получилось. Текст ошибки выше.
  pause
  exit /b 1
)
echo.
echo ${done}
pause
`;

const crlf = (s) => s.replace(/\r?\n/g, '\r\n');
await writeFile(`${OUT}/Установить.bat`, crlf(bat('install', 'Готово! В Яндекс Музыке включи трек и нажми L или кнопку "Текст".')));
await writeFile(`${OUT}/Удалить.bat`, crlf(bat('restore', 'Мод удалён, Яндекс Музыка восстановлена.')));
await writeFile(
  `${OUT}/ПРОЧТИ.txt`,
  crlf(`YM Lyrics v${version} — синхронный текст, визуализатор и тема для десктопной Яндекс Музыки (Windows)

Установка: просто запусти «Установить.bat».
  Установщик сам закроет Яндекс Музыку, сделает резервную копию, встроит мод и снова её откроет.
  Если Node.js не установлен, он один раз скачает портативную версию (~30 МБ) в %LOCALAPPDATA%\\ym-lyrics.
В приложении: включи трек и нажми L (или кнопку «Текст»). Настройки — кнопка ⚙.

После автообновления Яндекс Музыки мод слетает — просто запусти «Установить.bat» ещё раз.
Удаление: «Удалить.bat» вернёт оригинальные файлы из резервной копии.

Windows может предупредить о файле из интернета — это нормально для .bat без цифровой подписи.
Исходный код: ${pkg.repository?.url || 'см. страницу репозитория'}
`),
);

execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${OUT}' -DestinationPath '${ZIP}' -Force`], { stdio: 'inherit' });
console.log(`готово: ${ZIP}`);
