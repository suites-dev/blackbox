import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { URL, fileURLToPath } from 'node:url';
import process from 'node:process';
import { example } from './support.mjs';

const cli = fileURLToPath(new URL('../scripts/validate-audit.mjs', import.meta.url));
const run = (args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 10000 });

test('returns usage 2 without required inputs', () => {
  assert.equal(run([]).status, 2);
});

test('validates supplied files and never executes receipt argv', () => {
  const root = mkdtempSync(join(tmpdir(), 'blackbox-skills-'));
  try {
    const { audit, receipts } = example();
    const marker = join(root, 'must-not-exist');
    receipts.receipts[0].argv = [process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unsafe')`];
    const a = join(root, 'audit.json');
    const r = join(root, 'receipts.json');
    writeFileSync(a, JSON.stringify(audit)); writeFileSync(r, JSON.stringify(receipts));
    const result = run([a, r]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).qualification, 'structure-and-receipt-links-only');
    assert.equal(existsSync(marker), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('malformed or oversized input fails without echoing its contents', () => {
  const root = mkdtempSync(join(tmpdir(), 'blackbox-skills-'));
  try {
    const bad = join(root, 'input.json');
    writeFileSync(bad, 'SYNTHETIC_PRIVATE_VALUE');
    let result = run([bad, bad]);
    assert.equal(result.status, 3);
    assert.ok(!`${result.stdout}${result.stderr}`.includes('SYNTHETIC_PRIVATE_VALUE'));
    writeFileSync(bad, 'x'.repeat(2 * 1024 * 1024 + 1));
    result = run([bad, bad]);
    assert.equal(result.status, 3);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
