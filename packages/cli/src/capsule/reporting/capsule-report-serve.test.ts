import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { renderCapsuleHtml, reportCapsule } from '@suites/blackbox-capsule-internal';
import { commandFixture, removeFixture, runCli } from './capsule-command.fixture.js';
import { runningReportCli } from '../../reporting/serve.fixture.js';

void test('served registry selects an exact session, shares static renderer, and shuts down', async () => {
  const fixture = await commandFixture('stopped');
  const child = await runningReportCli({
    directory: fixture.directory,
    argv: ['--session', fixture.sessionId],
  });
  try {
    const origin = new URL(child.url).origin;
    assert.equal(new URL(child.url).searchParams.get('id'), fixture.sessionId);
    const records = await (await fetch(`${origin}/api/reports`)).json();
    assert.equal(records.reports[0].id, fixture.sessionId);
    const path = join(fixture.artifactRoot, 'session.json');
    const before = await readFile(path, 'utf8');
    const report = await (await fetch(`${origin}/api/reports/capsule/${fixture.sessionId}`)).json();
    assert.equal(report.document.session.sessionId, fixture.sessionId);
    assert.equal(report.document.cleanup.kind, 'complete');
    const html = await (await fetch(`${origin}/reports/capsule/${fixture.sessionId}`)).text();
    const capsuleReport = await reportCapsule({
      projectDirectory: fixture.directory,
      sessionId: fixture.sessionId,
    });
    assert.equal(capsuleReport.kind, 'capsule-report');
    assert.equal(html, renderCapsuleHtml({ report: capsuleReport.document }));
    const htmlPath = join(fixture.directory, 'snapshot.html');
    const exported = await runCli({
      directory: fixture.directory,
      argv: [
        'capsule',
        'report',
        'export',
        '--session',
        fixture.sessionId,
        '--format',
        'html',
        '--output',
        htmlPath,
      ],
    });
    assert.equal(exported.status, 0, exported.stderr);
    assert.equal(html, await readFile(htmlPath, 'utf8'));
    assert.equal(await readFile(path, 'utf8'), before);
  } finally {
    assert.equal(await child.stop(), 0);
    await removeFixture(fixture.directory);
  }
  await assert.rejects(fetch(child.url));
});

void test('registry loads summaries while a corrupt activity artifact stays explicitly unavailable', async () => {
  const fixture = await commandFixture('stopped');
  await writeFile(join(fixture.artifactRoot, 'activities.json'), '{broken');
  const child = await runningReportCli({ directory: fixture.directory, argv: [] });
  try {
    const origin = new URL(child.url).origin;
    const registry = await (await fetch(`${origin}/api/reports`)).json();
    assert.equal(registry.reports[0].id, fixture.sessionId);
    const report = await fetch(`${origin}/api/reports/capsule/${fixture.sessionId}`);
    assert.equal(report.status, 422);
    assert.equal((await report.json()).code, 'artifact-unavailable');
  } finally {
    await child.stop();
    await removeFixture(fixture.directory);
  }
});

void test('report flags require an explicit nonconflicting mode and exact static selection', async () => {
  const fixture = await commandFixture('stopped');
  try {
    for (const args of [
      ['export'],
      ['export', '--session', fixture.sessionId],
      ['export', '--session', fixture.sessionId, '--format', 'pdf'],
      ['export', '--session', fixture.sessionId, '--format', 'html', '--output', '-'],
      ['export', '--session', fixture.sessionId, '--format', 'json', '--port', '10000'],
      ['serve', '--format', 'html'],
      ['serve', '--output', 'out.html'],
      ['serve', '--port', '-1'],
      ['--serve'],
      ['--html'],
      ['--json'],
    ]) {
      const result = await runCli({
        directory: fixture.directory,
        argv: ['capsule', 'report', ...args],
      });
      assert.equal(result.status, 2, `${args.join(' ')}: ${result.stderr}`);
    }
  } finally {
    await removeFixture(fixture.directory);
  }
});
