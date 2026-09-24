import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import test from 'node:test';
import { capsuleSessionDirectory } from '@suites/blackbox-capsule-internal';
import { commandFixture, removeFixture, runCli } from './capsule-command.fixture.js';
import { runningReportCli } from '../../reporting/serve.fixture.js';

void test('served registry discovers newly retained sessions without changing exact selection', async () => {
  const fixture = await commandFixture('stopped');
  const child = await runningReportCli({
    directory: fixture.directory,
    argv: ['--session', fixture.sessionId],
  });
  try {
    const origin = new URL(child.url).origin;
    const first = await (await fetch(`${origin}/api/reports`)).json();
    assert.deepEqual(
      first.reports.map((entry: { id: string }) => entry.id),
      [fixture.sessionId],
    );
    assert.equal(first.reports[0].title, 'Orders demo');
    assert.deepEqual(first.reports[0].description, {
      kind: 'available',
      value: 'Recorded orders experiment',
    });
    const sessionId = 'bright-meadow-zoe';
    const artifactRoot = capsuleSessionDirectory({
      projectDirectory: fixture.directory,
      sessionId,
    });
    await mkdir(artifactRoot);
    await writeFile(
      join(artifactRoot, 'session.json'),
      JSON.stringify({ ...fixture.record, sessionId, artifactRoot, system: 'payments' }),
    );
    await writeFile(join(artifactRoot, 'activities.json'), '[]');
    await writeFile(
      join(artifactRoot, 'progress.json'),
      JSON.stringify({ schemaVersion: 1, kind: 'capsule-progress', events: [] }),
    );
    const refreshed = await (await fetch(`${origin}/api/reports/capsule`)).json();
    assert.deepEqual(
      refreshed.reports.map((entry: { id: string }) => entry.id).sort(),
      [sessionId, fixture.sessionId].sort(),
    );
    for (const id of [sessionId, fixture.sessionId]) {
      const result = await (await fetch(`${origin}/api/reports/capsule/${id}`)).json();
      assert.equal(result.document.session.sessionId, id);
    }
    const missing = await fetch(`${origin}/api/reports/capsule/no-such-session`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, 'not-found');
    assert.equal(new URL(child.url).searchParams.get('id'), fixture.sessionId);
  } finally {
    await child.stop();
    await removeFixture(fixture.directory);
  }
});

void test('served artifact exports match JSON reports and deny raw retained files', async () => {
  const fixture = await commandFixture('stopped');
  const child = await runningReportCli({ directory: fixture.directory, argv: [] });
  try {
    assert.equal(new URL(child.url).search, '');
    const origin = new URL(child.url).origin;
    const path = `${origin}/api/reports/capsule/${fixture.sessionId}/artifacts`;
    const artifactResponse = await fetch(`${path}/report.json`);
    assert.equal(artifactResponse.status, 200);
    const artifact = await artifactResponse.json();
    const snapshot = await runCli({
      directory: fixture.directory,
      argv: [
        'capsule',
        'report',
        'export',
        '--session',
        fixture.sessionId,
        '--format',
        'json',
        '--output',
        '-',
      ],
    });
    assert.equal(snapshot.status, 0, snapshot.stderr);
    assert.deepEqual(artifact.document, JSON.parse(snapshot.stdout));
    assert.doesNotMatch(JSON.stringify(artifact), /manager\.sock/u);
    for (const name of ['session.json', 'activities.json', 'progress.json']) {
      const response = await fetch(`${path}/${name}`);
      assert.equal(response.status, 404);
      assert.equal((await response.json()).code, 'not-found');
    }
    const missing = await fetch(
      `${origin}/api/reports/capsule/no-such-session/artifacts/report.json`,
    );
    assert.equal(missing.status, 404);
  } finally {
    await child.stop();
    await removeFixture(fixture.directory);
  }
});

void test('SIGTERM closes the CLI report listener and releases its port', async () => {
  const fixture = await commandFixture('stopped');
  const child = await runningReportCli({ directory: fixture.directory, argv: [] });
  try {
    const closed = once(child.child, 'close');
    child.child.kill('SIGTERM');
    assert.deepEqual(await closed, [0, null]);
    await assert.rejects(fetch(child.url));
    const rebound = await runningReportCli({
      directory: fixture.directory,
      argv: ['--port', new URL(child.url).port],
    });
    try {
      assert.equal((await fetch(rebound.url)).status, 200);
    } finally {
      assert.equal(await rebound.stop(), 0);
    }
  } finally {
    await child.stop();
    await removeFixture(fixture.directory);
  }
});

void test('an occupied report port fails without announcing a server or taking over its listener', async () => {
  const fixture = await commandFixture('stopped');
  const occupied = createServer((_request, response) => {
    response.writeHead(404).end();
  });
  occupied.listen(0, '127.0.0.1');
  await once(occupied, 'listening');
  try {
    const address = occupied.address();
    assert.ok(address !== null && typeof address !== 'string');
    const result = await runCli({
      directory: fixture.directory,
      argv: ['capsule', 'report', 'serve', '--port', String(address.port)],
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /occupied by an incompatible viewer/u);
    assert.doesNotMatch(result.stdout, /Blackbox reports:/u);
    assert.equal(occupied.listening, true);
  } finally {
    occupied.closeAllConnections();
    await new Promise<void>((resolve) =>
      occupied.close(() => {
        resolve();
      }),
    );
    await removeFixture(fixture.directory);
  }
});

void test('registry corruption stays visible and registry I/O failure cannot become empty success', async () => {
  const fixture = await commandFixture('stopped');
  const child = await runningReportCli({ directory: fixture.directory, argv: [] });
  try {
    const origin = new URL(child.url).origin;
    await writeFile(join(fixture.artifactRoot, 'session.json'), '{broken');
    const corrupt = await (await fetch(`${origin}/api/reports`)).json();
    assert.deepEqual(
      corrupt.reports.map((entry: { id: string; state: string }) => ({
        id: entry.id,
        state: entry.state,
      })),
      [{ id: fixture.sessionId, state: 'record-corrupt' }],
    );
    for (const suffix of ['', '/artifacts/report.json']) {
      const response = await fetch(`${origin}/api/reports/capsule/${fixture.sessionId}${suffix}`);
      assert.equal(response.status, 422);
      assert.equal((await response.json()).code, 'artifact-unavailable');
    }
    const experiments = join(fixture.directory, '.blackbox', 'experiments');
    await rename(experiments, `${experiments}-retained`);
    await writeFile(experiments, 'not a directory');
    const unavailable = await (await fetch(`${origin}/api/reports`)).json();
    assert.deepEqual(unavailable.reports, []);
    assert.equal(unavailable.failures.length, 1);
    assert.equal(unavailable.failures[0].type, 'capsule');
    assert.equal(unavailable.failures[0].failure.code, 'artifact-unavailable');
  } finally {
    await child.stop();
    await removeFixture(fixture.directory);
  }
});
