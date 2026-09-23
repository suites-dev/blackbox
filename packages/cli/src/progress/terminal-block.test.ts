import assert from 'node:assert/strict';
import test from 'node:test';
import { TerminalBlock } from './terminal-block.js';
import { TerminalScreen } from './terminal-screen.fixture.js';
import { clipTerminalText, terminalText, terminalWidth } from './terminal-text.js';

void test('replaces rows, erases removed rows, and never clears unrelated terminal content', () => {
  const screen = new TerminalScreen(70);
  const block = new TerminalBlock({ color: false, write: (text) => { screen.write(text); }, viewport: () => ({ columns: 70, rows: 24 }) });
  block.render({ lines: ['header', 'old resource', 'old failure'].map((text) => ({ text, tone: 'neutral' })) });
  block.render({ lines: [{ text: 'new header', tone: 'active' }, { text: 'new resource', tone: 'success' }] });
  assert.equal(screen.text(), 'user output\nnew header\nnew resource');
  block.render({ lines: [{ text: 'done', tone: 'success' }] });
  block.finish();
  assert.equal(screen.text(), 'user output\ndone');
  const writes = screen.writes;
  block.finish(); block.render({ lines: [] });
  assert.equal(screen.writes, writes);
  assert.equal(screen.wraps, 0);
});

void test('reflows the old frame after a width shrink and redraws only its own physical rows', () => {
  let columns = 70;
  const screen = new TerminalScreen(columns);
  const block = new TerminalBlock({ color: false, write: (text) => { screen.write(text); }, viewport: () => ({ columns, rows: 24 }) });
  block.render({ lines: [{ text: 'h'.repeat(61), tone: 'active' }, { text: 'r'.repeat(59), tone: 'neutral' }] });
  columns = 23;
  screen.resize(columns);
  block.render({ lines: [{ text: 'short header', tone: 'active' }, { text: 'healthy', tone: 'success' }] });
  block.finish();
  assert.equal(screen.text(), 'user output\nshort header\nhealthy');
  assert.equal(screen.wraps, 0);
});

void test('keeps a header on very short screens and advertises omitted rows on bounded screens', () => {
  for (const rows of [2, 5]) {
    const screen = new TerminalScreen(45);
    const block = new TerminalBlock({ color: false, write: (text) => { screen.write(text); }, viewport: () => ({ columns: 45, rows }) });
    block.render({ lines: Array.from({ length: 10 }, (_, index) => ({ text: index === 0 ? 'Acquiring capsule' : `resource ${index}`, tone: 'neutral' as const })) });
    block.finish();
    assert.match(screen.text(), /user output\nAcquiring capsule/u);
    assert.equal(screen.text().split('\n').length <= rows, true);
    if (rows > 2) { assert.match(screen.text(), /more steps/u); }
  }
});

void test('clips whole graphemes by terminal cell width and strips cursor injection from retained text', () => {
  assert.equal(terminalWidth('資料👩‍💻e\u0301'), 7);
  assert.equal(clipTerminalText({ text: '資料👩‍💻e\u0301long', columns: 7 }), '資料👩‍💻…');
  assert.equal(clipTerminalText({ text: 'too long', columns: 0 }), '');
  assert.equal(terminalText('api\u001b[2J\n\tbad'), 'api  bad');
  const screen = new TerminalScreen(9);
  const block = new TerminalBlock({ color: true, write: (text) => { screen.write(text); }, viewport: () => ({ columns: 9, rows: 24 }) });
  block.render({ lines: [{ text: '資料👩‍💻e\u0301long', tone: 'success' }] });
  block.finish();
  assert.equal(screen.wraps, 0);
  assert.equal(screen.text().startsWith('user output\n'), true);
});
