import assert from 'node:assert/strict';
import test from 'node:test';

import {
  commandFixture,
  fakeManager,
  fixtureActivityId,
  removeFixture,
  runCli,
} from './reporting/capsule-command.fixture.js';

function durationOf(stderr: string): string {
  const match = /· (\d+(?:\.\d)?m?s)\n/u.exec(stderr);
  return match === null ? 'no duration' : match[1];
}

void test('run forwards literal host argv and purpose through real CLI-to-manager IPC', async () => {
  const fixture = await commandFixture('running');
  const outcome = {
    kind: 'exited',
    argv: ['printf', 'literal;$(unexpanded)'],
    exitCode: 7,
    stdout: 'visible-out\n',
    stderr: 'visible-error\n',
    location: { kind: 'host' },
    retention: {
      stdout: { kind: 'complete', originalBytes: 12 },
      stderr: { kind: 'complete', originalBytes: 14 },
    },
  };
  const manager = await fakeManager({ socketPath: fixture.socketPath, outcome });
  try {
    const result = await runCli({
      directory: fixture.directory,
      argv: [
        'capsule',
        'run',
        '--session',
        fixture.sessionId,
        '--purpose',
        'setup',
        '--',
        ...outcome.argv,
      ],
    });
    assert.equal(result.status, 7, result.stderr);
    assert.equal(result.stdout, outcome.stdout);
    assert.equal(
      result.stderr,
      'visible-error\n' +
        `activity 00000000 · capsule ${fixture.sessionId} · setup · host · host · exit 7 · ${durationOf(result.stderr)}\n` +
        `→ blackbox capsule show 00000000 --session ${fixture.sessionId}\n`,
    );
    assert.equal(manager.requests.length, 1);
    assert.deepEqual((manager.requests[0] as { name: unknown }).name, { kind: 'omitted' });
    assert.equal((manager.requests[0] as { purpose: unknown }).purpose, 'setup');
    assert.deepEqual((manager.requests[0] as { target: unknown }).target, {
      kind: 'host',
      argv: outcome.argv,
    });
  } finally {
    await manager.close();
    await removeFixture(fixture.directory);
  }
});

void test('JSON run stdout is one parseable document even when the delegated command prints', async () => {
  const fixture = await commandFixture('running');
  const outcome = {
    kind: 'exited',
    argv: ['printf', 'hello'],
    exitCode: 0,
    stdout: 'hello\n',
    stderr: '',
    location: { kind: 'host' },
    retention: {
      stdout: { kind: 'complete', originalBytes: 6 },
      stderr: { kind: 'complete', originalBytes: 0 },
    },
  };
  const manager = await fakeManager({ socketPath: fixture.socketPath, outcome });
  try {
    const result = await runCli({
      directory: fixture.directory,
      argv: ['capsule', 'run', '--session', fixture.sessionId, '--json', '--', ...outcome.argv],
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      kind: 'capsule-exec-completed',
      activityId: fixtureActivityId,
      outcome,
      capsule: fixture.sessionId,
      next: [`blackbox capsule show 00000000 --session ${fixture.sessionId}`],
    });
  } finally {
    await manager.close();
    await removeFixture(fixture.directory);
  }
});

void test('signaled host commands remain failures and preserve diagnostic output', async () => {
  const fixture = await commandFixture('running');
  const outcome = {
    kind: 'signaled',
    argv: ['worker'],
    signal: 'SIGTERM',
    stdout: '',
    stderr: 'interrupted\n',
    location: { kind: 'host' },
    retention: {
      stdout: { kind: 'complete', originalBytes: 0 },
      stderr: { kind: 'complete', originalBytes: 12 },
    },
  };
  const manager = await fakeManager({ socketPath: fixture.socketPath, outcome });
  try {
    const result = await runCli({
      directory: fixture.directory,
      argv: ['capsule', 'run', '--session', fixture.sessionId, '--', 'worker'],
    });
    assert.equal(result.status, 128 + 15);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^interrupted\n/u);
    assert.match(result.stderr, /activity 00000000 · .* · signal SIGTERM · /u);
  } finally {
    await manager.close();
    await removeFixture(fixture.directory);
  }
});

void test('down is idempotent for an exact already-stopped session', async () => {
  const fixture = await commandFixture('stopped');
  try {
    const result = await runCli({
      directory: fixture.directory,
      argv: ['capsule', 'down', '--session', fixture.sessionId, '--json'],
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      kind: 'capsule-stopped',
      sessionId: fixture.sessionId,
      cleanup: 'complete',
      alreadyStopped: true,
      capsule: fixture.sessionId,
      warnings: [],
      next: [`blackbox capsule report ${fixture.sessionId}`],
    });
  } finally {
    await removeFixture(fixture.directory);
  }
});

void test('usage errors are rejected before any Capsule acquisition', async () => {
  const fixture = await commandFixture('stopped');
  try {
    for (const argv of [
      ['capsule', 'up', 'orders', '--silent', '--interactive'],
      ['capsule', 'up', 'orders', '--env', 'NOT_AN_ASSIGNMENT'],
      [
        'capsule',
        'report',
        'export',
        '--session',
        fixture.sessionId,
        '--format',
        'json',
        '--output',
        '-',
        '--format',
        'html',
      ],
    ]) {
      const result = await runCli({ directory: fixture.directory, argv });
      assert.equal(result.status, 2, result.stderr);
      assert.equal(result.stdout, '');
    }
    // run keeps 1..124 for the child: its own usage errors exit 125.
    for (const argv of [
      ['capsule', 'run', '--session', fixture.sessionId],
      ['capsule', 'run', '--session', fixture.sessionId, '--name', '   ', '--', 'true'],
      ['capsule', 'run', '--session', fixture.sessionId, '--name', 'a'.repeat(121), '--', 'true'],
      ['capsule', 'run', '--session', fixture.sessionId, '--purpose', 'destructive', '--', 'true'],
    ]) {
      const result = await runCli({ directory: fixture.directory, argv });
      assert.equal(result.status, 125, result.stderr);
      assert.equal(result.stdout, '');
    }
  } finally {
    await removeFixture(fixture.directory);
  }
});

void test('JSON operation failures emit one parseable document without human diagnostics', async () => {
  const fixture = await commandFixture('stopped');
  try {
    const result = await runCli({
      directory: fixture.directory,
      argv: ['capsule', 'run', '--session', fixture.sessionId, '--json', '--', 'true'],
    });
    assert.equal(result.status, 125);
    assert.deepEqual(JSON.parse(result.stdout), {
      kind: 'cli-error',
      code: 'capsule-not-running',
      message: `capsule ${fixture.sessionId} is stopped; run needs a running capsule`,
      next: ['blackbox capsule up'],
    });
    assert.equal(result.stderr, '');
  } finally {
    await removeFixture(fixture.directory);
  }
});
