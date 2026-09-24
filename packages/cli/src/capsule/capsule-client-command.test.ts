import assert from 'node:assert/strict';
import test from 'node:test';

import {
  commandFixture,
  fakeManager,
  removeFixture,
  runCli,
} from './reporting/capsule-command.fixture.js';

void test('exec sends a client target with literal args and renders its typed result', async () => {
  const fixture = await commandFixture('running');
  const outcome = {
    kind: 'client-completed',
    client: { id: 'create-order', name: 'Create order', behavior: 'utility' },
    result: { kind: 'json', value: { orderId: 'order-1' } },
    telemetry: { kind: 'not-requested' },
  };
  const manager = await fakeManager({ socketPath: fixture.socketPath, outcome });
  try {
    const result = await runCli({
      directory: fixture.directory,
      argv: [
        'capsule',
        'exec',
        '--session',
        fixture.sessionId,
        '--client',
        'create-order',
        '--',
        'alice',
        '--literal=$(safe)',
      ],
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { orderId: 'order-1' });
    assert.deepEqual((manager.requests[0] as { target: unknown }).target, {
      kind: 'client',
      clientId: 'create-order',
      args: ['alice', '--literal=$(safe)'],
    });
  } finally {
    await manager.close();
    await removeFixture(fixture.directory);
  }
});

void test('JSON client execution emits the complete protocol outcome as one document', async () => {
  const fixture = await commandFixture('running');
  const outcome = {
    kind: 'client-completed',
    client: { id: 'create-order', name: 'Create order', behavior: 'entrypoint' },
    result: { kind: 'text', value: 'created\n' },
    telemetry: {
      kind: 'incomplete',
      error: { name: 'CollectorUnavailable', message: 'collector stopped' },
    },
  };
  const manager = await fakeManager({ socketPath: fixture.socketPath, outcome });
  try {
    const result = await runCli({
      directory: fixture.directory,
      argv: [
        'capsule',
        'exec',
        '--session',
        fixture.sessionId,
        '--client',
        'create-order',
        '--json',
      ],
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), outcome);
    assert.equal(result.stderr, '');
    assert.deepEqual((manager.requests[0] as { target: unknown }).target, {
      kind: 'client',
      clientId: 'create-order',
      args: [],
    });
  } finally {
    await manager.close();
    await removeFixture(fixture.directory);
  }
});

void test('exec rejects ambiguous client and participant selection before IPC', async () => {
  const fixture = await commandFixture('running');
  try {
    const result = await runCli({
      directory: fixture.directory,
      argv: [
        'capsule',
        'exec',
        '--session',
        fixture.sessionId,
        '--client',
        'create-order',
        '--participant',
        'api',
      ],
    });
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /cannot be used together/u);
  } finally {
    await removeFixture(fixture.directory);
  }
});
