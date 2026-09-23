import assert from 'node:assert/strict';
import test from 'node:test';

import { commandFixture, fakeManager, removeFixture, runCli } from './capsule-command.fixture.js';

void test('exec forwards literal argv and participant identity through real CLI-to-manager IPC', async () => {
  const fixture = await commandFixture('running');
  const outcome = { kind: 'exited', argv: ['printf', 'literal;$(unexpanded)'], exitCode: 7, stdout: 'visible-out\n', stderr: 'visible-error\n' };
  const manager = await fakeManager({ socketPath: fixture.socketPath, outcome });
  try {
    const result = await runCli({ directory: fixture.directory, argv: ['capsule', 'exec', '--session', fixture.sessionId, '--participant', 'postgres', '--', ...outcome.argv] });
    assert.equal(result.status, 7, result.stderr);
    assert.equal(result.stdout, outcome.stdout);
    assert.match(result.stderr, /visible-error/u);
    assert.match(result.stderr, /command exited with 7/u);
    assert.equal(manager.requests.length, 1);
    assert.deepEqual((manager.requests[0] as { target: unknown }).target, { kind: 'participant', participant: 'postgres', argv: outcome.argv });
  } finally {
    await manager.close();
    await removeFixture(fixture.directory);
  }
});

void test('JSON exec stdout is one parseable document even when the delegated command prints', async () => {
  const fixture = await commandFixture('running');
  const outcome = { kind: 'exited', argv: ['printf', 'hello'], exitCode: 0, stdout: 'hello\n', stderr: '' };
  const manager = await fakeManager({ socketPath: fixture.socketPath, outcome });
  try {
    const result = await runCli({ directory: fixture.directory, argv: ['capsule', 'exec', '--session', fixture.sessionId, '--json', '--', ...outcome.argv] });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), outcome);
  } finally {
    await manager.close();
    await removeFixture(fixture.directory);
  }
});

void test('signaled host commands remain failures and preserve diagnostic output', async () => {
  const fixture = await commandFixture('running');
  const outcome = { kind: 'signaled', argv: ['worker'], signal: 'SIGTERM', stdout: '', stderr: 'interrupted\n' };
  const manager = await fakeManager({ socketPath: fixture.socketPath, outcome });
  try {
    const result = await runCli({ directory: fixture.directory, argv: ['capsule', 'exec', '--session', fixture.sessionId, '--', 'worker'] });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /interrupted/u);
    assert.match(result.stderr, /SIGTERM/u);
  } finally {
    await manager.close();
    await removeFixture(fixture.directory);
  }
});

void test('stop is idempotent for an exact already-stopped session', async () => {
  const fixture = await commandFixture('stopped');
  try {
    const result = await runCli({ directory: fixture.directory, argv: ['capsule', 'stop', '--session', fixture.sessionId, '--json'] });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { kind: 'capsule-stopped', sessionId: fixture.sessionId, cleanup: 'complete', alreadyStopped: true });
  } finally { await removeFixture(fixture.directory); }
});

void test('usage errors are rejected before any Capsule acquisition', async () => {
  const fixture = await commandFixture('stopped');
  try {
    for (const argv of [
      ['capsule', 'start', '--system', 'orders', '--silent', '--interactive'],
      ['capsule', 'start', '--system', 'orders', '--env', 'NOT_AN_ASSIGNMENT'],
      ['capsule', 'exec', '--session', fixture.sessionId],
      ['capsule', 'report', 'export', '--session', fixture.sessionId, '--format', 'json', '--output', '-', '--format', 'html'],
    ]) {
      const result = await runCli({ directory: fixture.directory, argv });
      assert.equal(result.status, 2, result.stderr);
      assert.equal(result.stdout, '');
    }
  } finally { await removeFixture(fixture.directory); }
});
