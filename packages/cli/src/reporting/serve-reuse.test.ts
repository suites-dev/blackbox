import assert from 'node:assert/strict';
import test from 'node:test';
import { commandFixture, removeFixture, runCli } from '../capsule-command.fixture.js';
import { capsuleReportProvider } from './capsule-provider.js';
import { runningReportCli } from './serve.fixture.js';
import { serveReport } from './serve.js';

void test('repeated and concurrent CLI serve requests reuse the owner and exit successfully', async () => {
  const fixture = await commandFixture('stopped');
  const owner = await runningReportCli({ directory: fixture.directory, argv: [] });
  try {
    const port = new URL(owner.url).port;
    const results = await Promise.all(Array.from({ length: 4 }, () => runCli({ directory: fixture.directory,
      argv: ['capsule', 'report', 'serve', '--port', port, '--session', fixture.sessionId] })));
    for (const result of results) {
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /^Viewer ownership: reused$/mu);
      assert.doesNotMatch(result.stdout, /Ctrl-C/u);
      const match = /^Blackbox reports: (.+)$/mu.exec(result.stdout);
      assert.ok(match);
      const url = match[1];
      assert.equal(new URL(url).port, port);
      assert.equal(new URL(url).searchParams.get('id'), fixture.sessionId);
      assert.equal((await fetch(url)).status, 200);
    }
    assert.equal(owner.child.exitCode, null);
  } finally { await owner.stop(); await removeFixture(fixture.directory); }
});

void test('another project cannot reuse or stop a viewer bound to the requested port', async () => {
  const fixture = await commandFixture('stopped');
  const other = await commandFixture('stopped');
  const owner = await runningReportCli({ directory: fixture.directory, argv: [] });
  try {
    const result = await runCli({ directory: other.directory,
      argv: ['capsule', 'report', 'serve', '--port', new URL(owner.url).port] });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /occupied by an incompatible viewer/u);
    assert.doesNotMatch(result.stdout, /Blackbox reports:/u);
    assert.equal((await fetch(owner.url)).status, 200);
    assert.equal(owner.child.exitCode, null);
  } finally { await owner.stop(); await removeFixture(fixture.directory); await removeFixture(other.directory); }
});

void test('reuse opens the selected URL and browser failure preserves the original owner', async () => {
  const fixture = await commandFixture('stopped');
  const owner = await runningReportCli({ directory: fixture.directory, argv: [] });
  const opened: string[] = [];
  const warnings: string[] = [];
  const listeners = process.listenerCount('SIGINT');
  try {
    for (const fail of [false, true]) {
      await serveReport({ kind: 'serve-report', projectDirectory: fixture.directory, port: Number(new URL(owner.url).port),
        provider: capsuleReportProvider({ projectDirectory: fixture.directory }),
        selection: { kind: 'report', type: 'capsule', id: fixture.sessionId },
        announce: ({ kind }) => { assert.equal(kind, 'report-server-reused'); },
        browser: { kind: 'open', launch: async ({ url }) => {
          opened.push(url);
          assert.equal((await fetch(url)).status, 200);
          if (fail) { throw new Error('Browser unavailable'); }
        }, warn: ({ message }) => { warnings.push(message); } },
      });
    }
    assert.equal(opened.length, 2);
    assert.equal(new URL(opened[0]).searchParams.get('id'), fixture.sessionId);
    assert.equal(warnings.length, 1);
    assert.equal(process.listenerCount('SIGINT'), listeners);
    assert.equal((await fetch(owner.url)).status, 200);
    assert.equal(owner.child.exitCode, null);
  } finally { await owner.stop(); await removeFixture(fixture.directory); }
});
