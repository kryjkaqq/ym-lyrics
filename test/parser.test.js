import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLrc, toSeconds } from '../src/renderer/lrc-parser.js';
import { buildTimeline, findActive, INTERLUDE_MIN_GAP } from '../src/renderer/word-timing.js';

// выдуманные строки для тестов
const SAMPLE = `[ar:Тестовый Артист]
[ti:Тестовая песня]
[00:01.00]Первая строчка про утро
[00:04.50]Вторая строчка, тише
[00:05.50]
[00:14.00][00:30.00]Повтор строки
[00:20.25]Последняя`;

test('toSeconds handles dot and colon fractions', () => {
  assert.equal(toSeconds('01', '02.50'), 62.5);
  assert.equal(toSeconds('0', '03:25'), 3.25);
});

test('parses basic LRC, skips meta, expands repeated stamps and sorts', () => {
  const p = parseLrc(SAMPLE);
  assert.equal(p.synced, true);
  assert.deepEqual(
    p.lines.map((l) => [l.start, l.text]),
    [
      [1, 'Первая строчка про утро'],
      [4.5, 'Вторая строчка, тише'],
      [5.5, ''],
      [14, 'Повтор строки'],
      [20.25, 'Последняя'],
      [30, 'Повтор строки'],
    ],
  );
});

test('applies [offset]', () => {
  const p = parseLrc('[offset:+500]\n[00:02.00]раз два');
  assert.equal(p.lines[0].start, 1.5);
});

test('parses enhanced word tags', () => {
  const p = parseLrc('[00:10.00]<00:10.00>Лети <00:10.60>бумажный <00:11.40>кораблик');
  assert.equal(p.lines[0].text, 'Лети бумажный кораблик');
  assert.deepEqual(
    p.lines[0].words.map((w) => [w.text, w.start]),
    [
      ['Лети', 10],
      ['бумажный', 10.6],
      ['кораблик', 11.4],
    ],
  );
});

test('plain text without stamps is unsynced', () => {
  const p = parseLrc('\nстрока один\n\n\nстрока два\n');
  assert.equal(p.synced, false);
  assert.deepEqual(p.lines.map((l) => l.text), ['строка один', '', 'строка два']);
});

test('timeline distributes words inside line and keeps order', () => {
  const tl = buildTimeline(parseLrc(SAMPLE), 40);
  const first = tl.lines.find((l) => l.type === 'line');
  assert.equal(first.words.length, 4);
  assert.equal(first.words[0].start, 1);
  for (let i = 1; i < first.words.length; i++) {
    assert.ok(first.words[i].start >= first.words[i - 1].end - 1e-9);
  }
  assert.ok(first.end <= 4.5);
  // длинное слово получает больше времени, чем короткое
  const [w1, , w3] = first.words;
  assert.ok(w1.end - w1.start > w3.end - w3.start);
});

test('timeline inserts interludes for long gaps and intro', () => {
  const tl = buildTimeline(parseLrc('[00:08.00]начало\n[00:09.00]дальше\n[00:30.00]после паузы'), 40);
  const types = tl.lines.map((l) => l.type);
  assert.deepEqual(types, ['interlude', 'line', 'line', 'interlude', 'line']);
  const gap = tl.lines[3];
  assert.ok(gap.end - gap.start >= INTERLUDE_MIN_GAP - 1);
});

test('enhanced timings are respected', () => {
  const tl = buildTimeline(parseLrc('[00:10.00]<00:10.00>Лети <00:10.60>бумажный <00:11.40>кораблик\n[00:15.00]дальше'), 20);
  const w = tl.lines.find((l) => l.type === 'line').words;
  assert.equal(w[1].start, 10.6);
  assert.equal(w[0].end, 10.6);
  assert.ok(w[2].end <= 15);
});

test('findActive returns last started line', () => {
  const lines = [{ start: 1 }, { start: 3 }, { start: 7 }];
  assert.equal(findActive(lines, 0.5), -1);
  assert.equal(findActive(lines, 1), 0);
  assert.equal(findActive(lines, 6.9), 1);
  assert.equal(findActive(lines, 100), 2);
});
