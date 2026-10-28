// Установка / удаление мода ym-lyrics в десктопную Яндекс Музыку (Windows).
//   node patcher/patch.mjs install [--no-launch]
//   node patcher/patch.mjs restore
//   node patcher/patch.mjs status

import * as asar from '@electron/asar';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// файлы мода: рядом в app/ (готовый релиз) или dist/ проекта (после node build.mjs)
const DIST = [process.env.YM_LYRICS_DIST, path.join(HERE, 'app'), path.join(HERE, '..', 'dist')].find((d) => d && fs.existsSync(path.join(d, 'ym-lyrics.js'))) || path.join(HERE, '..', 'dist');
const APP_DIR = process.env.YM_DIR || path.join(process.env.LOCALAPPDATA || '', 'Programs', 'YandexMusic');
const EXE_NAME = 'Яндекс Музыка.exe';
const EXE = path.join(APP_DIR, EXE_NAME);
const ASAR = path.join(APP_DIR, 'resources', 'app.asar');
const ASAR_BAK = `${ASAR}.ym-lyrics.bak`;
const EXE_BAK = `${EXE}.ym-lyrics.bak`;
const MARKER = 'ym-lyrics.marker';
const SCRIPT_TAG = '<script src="/ym-lyrics.js" data-ym-lyrics></script>';

const log = (...a) => console.log('[ym-lyrics]', ...a);
const die = (msg) => {
  console.error(`\n[ym-lyrics] ОШИБКА: ${msg}\n`);
  process.exit(1);
};

const headerHash = (file) => createHash('sha256').update(asar.getRawHeader(file).headerString).digest('hex');
const isPatched = (file) => asar.listPackage(file).some((p) => p.replace(/\\/g, '/') === `/${MARKER}`);
const appVersion = (file) => JSON.parse(asar.extractFile(file, 'package.json').toString()).version;

// закрываем только процессы из папки, которую патчим (а не любую копию приложения)
function closeApp() {
  const dir = (APP_DIR.toLowerCase() + path.sep).replace(/'/g, "''");
  const ps = `$d='${dir}';$p=Get-Process | Where-Object { $_.Path -and $_.Path.ToLower().StartsWith($d) }; if ($p) { $p | Stop-Process -Force; 'killed' }`;
  const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
  if (!out.includes('killed')) return;
  log('Яндекс Музыка закрыта');
  const until = Date.now() + 8000;
  while (Date.now() < until) {
    try {
      fs.renameSync(EXE, EXE); // файл ещё занят — бросит EBUSY/EPERM
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
}

function launchApp() {
  spawn(EXE, [], { detached: true, stdio: 'ignore', cwd: APP_DIR }).unref();
  log('Яндекс Музыка запущена');
}

// хеш заголовка asar зашит в exe (фьюз EnableEmbeddedAsarIntegrityValidation) — меняем строку той же длины
function updateExeIntegrity(oldHash, newHash) {
  const buf = fs.readFileSync(EXE);
  const needle = Buffer.from(`"value":"${oldHash}"`);
  const at = buf.indexOf(needle);
  if (at < 0) {
    if (buf.indexOf(Buffer.from(`"value":"${newHash}"`)) >= 0) return;
    die('не нашёл хеш целостности app.asar в exe — версия приложения не поддерживается. Запусти "uninstall".');
  }
  if (buf.indexOf(needle, at + 1) >= 0) die('хеш целостности встречается в exe несколько раз — отменено');
  Buffer.from(`"value":"${newHash}"`).copy(buf, at);
  fs.writeFileSync(EXE, buf);
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function injectInto(dir) {
  const read = (f) => fs.readFileSync(path.join(DIST, f), 'utf8');

  // 1. скрипт мода
  fs.copyFileSync(path.join(DIST, 'ym-lyrics.js'), path.join(dir, 'app', 'ym-lyrics.js'));
  // шрифты для выбора в настройках — грузятся браузером только когда выбраны
  if (fs.existsSync(path.join(DIST, 'fonts'))) fs.cpSync(path.join(DIST, 'fonts'), path.join(dir, 'app', 'ym-lyrics-fonts'), { recursive: true });

  // 2. <script> первым в <head> всех страниц приложения
  let pages = 0;
  for (const f of walk(path.join(dir, 'app')).filter((f) => f.endsWith('.html'))) {
    const html = fs.readFileSync(f, 'utf8');
    if (html.includes('data-ym-lyrics')) continue;
    const next = html.replace(/<head[^>]*>/i, (m) => m + SCRIPT_TAG);
    if (next !== html) {
      fs.writeFileSync(f, next);
      pages++;
    }
  }
  if (!pages) die('не нашёл HTML-страниц приложения для подключения скрипта');

  // 3. мост для сетевых запросов: preload + обработчик в main-процессе
  const preload = path.join(dir, 'preload.js');
  const main = path.join(dir, 'index.js');
  if (!fs.readFileSync(preload, 'utf8').includes('ym-lyrics:preload')) fs.appendFileSync(preload, read('preload-hook.js'));
  if (!fs.readFileSync(main, 'utf8').includes('ym-lyrics:main')) fs.appendFileSync(main, read('main-hook.js'));

  fs.writeFileSync(path.join(dir, MARKER), JSON.stringify({ installedAt: new Date().toISOString() }));
  return pages;
}

async function install({ launch }) {
  for (const f of ['ym-lyrics.js', 'preload-hook.js', 'main-hook.js']) {
    if (!fs.existsSync(path.join(DIST, f))) die(`нет dist/${f} — сначала собери: node build.mjs`);
  }
  if (!fs.existsSync(ASAR) || !fs.existsSync(EXE)) die(`Яндекс Музыка не найдена в ${APP_DIR} (можно указать путь через переменную YM_DIR)`);

  closeApp();

  // свежая (неизменённая) версия приложения — обновляем бэкапы; уже пропатченная — пересобираем из бэкапа
  if (!isPatched(ASAR)) {
    fs.copyFileSync(ASAR, ASAR_BAK);
    fs.copyFileSync(EXE, EXE_BAK);
    log(`бэкап создан (версия ${appVersion(ASAR)})`);
  } else if (!fs.existsSync(ASAR_BAK)) {
    die('мод уже установлен, но бэкап не найден — переустанови Яндекс Музыку и запусти установку заново');
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ym-lyrics-'));
  try {
    log('распаковка app.asar…');
    asar.extractAll(ASAR_BAK, tmp);
    const pages = injectInto(tmp);
    log(`скрипт подключён к ${pages} страницам`);

    log('сборка app.asar…');
    const out = `${ASAR}.ym-lyrics.tmp`;
    await asar.createPackageWithOptions(tmp, out, {});
    const oldHash = headerHash(ASAR);
    const newHash = headerHash(out);
    updateExeIntegrity(oldHash, newHash);
    fs.renameSync(out, ASAR);
    log('готово ✔');
  } catch (e) {
    // откат, чтобы приложение не осталось сломанным
    try {
      fs.copyFileSync(ASAR_BAK, ASAR);
      fs.copyFileSync(EXE_BAK, EXE);
    } catch {}
    throw e;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (launch) launchApp();
}

function restore() {
  if (!fs.existsSync(ASAR_BAK) || !fs.existsSync(EXE_BAK)) die('бэкап не найден — нечего восстанавливать');
  closeApp();
  fs.copyFileSync(ASAR_BAK, ASAR);
  fs.copyFileSync(EXE_BAK, EXE);
  log('оригинальная Яндекс Музыка восстановлена ✔');
}

function status() {
  if (!fs.existsSync(ASAR)) die(`Яндекс Музыка не найдена в ${APP_DIR}`);
  log(`путь: ${APP_DIR}`);
  log(`версия: ${appVersion(ASAR)}`);
  log(`мод установлен: ${isPatched(ASAR) ? 'да' : 'нет'}`);
  log(`бэкап: ${fs.existsSync(ASAR_BAK) ? 'есть' : 'нет'}`);
}

const [cmd = 'install', ...flags] = process.argv.slice(2);
if (process.platform !== 'win32') die('патчер рассчитан на Windows');
try {
  if (cmd === 'install') await install({ launch: !flags.includes('--no-launch') });
  else if (cmd === 'restore' || cmd === 'uninstall') restore();
  else if (cmd === 'status') status();
  else die(`неизвестная команда ${cmd}`);
} catch (e) {
  die(e.stack || e.message);
}
