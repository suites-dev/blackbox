import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { commandFixture, removeFixture, runCli } from './capsule-command.fixture.js';

void test('JSON report selects the exact session and preserves cleanup truth', async () => {
  const fixture = await commandFixture('stopped');
  try {
    const result = await runCli({ directory: fixture.directory, argv: ['capsule', 'report', 'export', '--session', fixture.sessionId, '--format', 'json', '--output', '-'] });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.kind, 'capsule-operational-report');
    assert.equal(report.session.sessionId, fixture.sessionId);
    assert.deepEqual(report.lifecycle, { kind: 'stopped', retainedState: 'stopped' });
    assert.deepEqual(report.cleanup, { kind: 'complete' });
    assert.doesNotMatch(result.stdout, /manager\.sock/u);
  } finally { await removeFixture(fixture.directory); }
});

void test('report requires an explicit presentation mode', async () => {
  const fixture = await commandFixture('stopped');
  try {
    const result = await runCli({ directory: fixture.directory, argv: ['capsule', 'report', 'export', '--session', fixture.sessionId] });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /format/u);
  } finally { await removeFixture(fixture.directory); }
});

void test('HTML report is portable, escapes retained text, and does not modify source evidence', async () => {
  const fixture = await commandFixture('stopped');
  try {
    const recordPath = join(fixture.artifactRoot, 'session.json');
    await writeFile(recordPath, JSON.stringify({ ...fixture.record, system: '<script>alert("unsafe")</script>' }));
    const before = await readFile(recordPath, 'utf8');
    const htmlPath = join(fixture.directory, 'report.html');
    const result = await runCli({ directory: fixture.directory, argv: ['capsule', 'report', 'export', '--session', fixture.sessionId, '--format', 'html', '--output', htmlPath] });
    assert.equal(result.status, 0, result.stderr);
    const html = await readFile(htmlPath, 'utf8');
    assert.match(html, /quiet-river-ada/u);
    assert.match(html, /&lt;script&gt;/u);
    assert.doesNotMatch(html, /<script>alert|(?:src|href)=["']https?:/u);
    assert.equal(await readFile(recordPath, 'utf8'), before);
  } finally { await removeFixture(fixture.directory); }
});

void test('corrupt artifacts fail without writing a misleading JSON export', async () => {
  const fixture = await commandFixture('stopped');
  try {
    await writeFile(join(fixture.artifactRoot, 'activities.json'), '{broken');
    const result = await runCli({ directory: fixture.directory, argv: ['capsule', 'report', 'export', '--session', fixture.sessionId, '--format', 'json', '--output', '-'] });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /activities artifact/u);
  } finally { await removeFixture(fixture.directory); }
});

void test('HTML mode creates its default directory and prints the generated snapshot path', async () => {
  const fixture = await commandFixture('stopped');
  try {
    const path = join(fixture.directory, '.blackbox', 'reports', `capsule-${fixture.sessionId}`, 'capsule-report.html');
    const before = await readFile(join(fixture.artifactRoot, 'session.json'), 'utf8');
    const result = await runCli({ directory: fixture.directory, argv: ['capsule', 'report', 'export', '--session', fixture.sessionId, '--format', 'html'] });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), path);
    assert.match(await readFile(path, 'utf8'), /quiet-river-ada/u);
    assert.equal(await readFile(join(fixture.artifactRoot, 'session.json'), 'utf8'), before);
  } finally { await removeFixture(fixture.directory); }
});

void test('JSON exports to default or nested custom paths match stdout without altering a running Capsule', async () => {
  const fixture = await commandFixture('running');
  try {
    const before = await readFile(join(fixture.artifactRoot, 'session.json'), 'utf8');
    const command = ['capsule', 'report', 'export', '--session', fixture.sessionId, '--format', 'json'];
    const stdout = await runCli({ directory: fixture.directory, argv: [...command, '--output', '-'] });
    assert.equal(stdout.status, 0, stdout.stderr);
    assert.equal(JSON.parse(stdout.stdout).lifecycle.kind, 'running');
    for (const output of [undefined, 'nested/custom/report.json']) {
      const result = await runCli({ directory: fixture.directory, argv: output === undefined ? command : [...command, '--output', output] });
      assert.equal(result.status, 0, result.stderr);
      const path = join(fixture.directory, output ?? `.blackbox/reports/capsule-${fixture.sessionId}/capsule-report.json`);
      assert.equal(result.stdout.trim(), path);
      assert.equal(await readFile(path, 'utf8'), stdout.stdout);
    }
    assert.equal(await readFile(join(fixture.artifactRoot, 'session.json'), 'utf8'), before);
  } finally { await removeFixture(fixture.directory); }
});

void test('report topic discovers both actions and export write failures are nonzero', async () => {
  const fixture = await commandFixture('stopped');
  try {
    const help = await runCli({ directory: fixture.directory, argv: ['capsule', 'report'] });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /capsule report export/u);
    assert.match(help.stdout, /capsule report serve/u);
    await writeFile(join(fixture.directory, 'blocked'), 'file, not directory');
    const result = await runCli({ directory: fixture.directory, argv: ['capsule', 'report', 'export', '--session', fixture.sessionId, '--format', 'html', '--output', 'blocked/report.html'] });
    assert.equal(result.status, 4);
    assert.equal(result.stdout, '');
  } finally { await removeFixture(fixture.directory); }
});
