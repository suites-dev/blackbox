import assert from 'node:assert/strict';
import test from 'node:test';

import {
  commandFixture,
  fakeManager,
  fixtureActivityId,
  removeFixture,
  runCli,
} from './reporting/capsule-command.fixture.js';

const completeRetention = {
  stdout: { kind: 'complete', originalBytes: 8 },
  stderr: { kind: 'complete', originalBytes: 0 },
} as const;

function completedDriverOutcome() {
  return {
    kind: 'driver-completed',
    driver: {
      id: 'public-api',
      target: {
        kind: 'participant',
        participantId: 'public-api',
        service: 'public-api',
        protocol: 'http',
        containerPort: 3000,
      },
      execution: { kind: 'host' },
    },
    propagation: {
      schemaVersion: 1,
      kind: 'telemetry-propagation-v1',
      expectation: {
        kind: 'w3c-trace-context-propagation',
        carrier: 'http-headers',
      },
      outcome: {
        kind: 'context-injected',
        format: 'w3c-trace-context',
        carrier: 'http-headers',
      },
    },
    redaction: {
      kind: 'driver-redaction',
      requestArgv: { kind: 'none' },
      preparedArgv: { kind: 'none' },
      environment: { kind: 'none' },
    },
    process: {
      kind: 'exited',
      argv: ['curl', '/orders'],
      location: { kind: 'host' },
      exitCode: 0,
      stdout: 'created\n',
      stderr: '',
      retention: completeRetention,
    },
  } as const;
}

void test('exec sends a driver target and renders the delegated process result', async () => {
  const fixture = await commandFixture('running');
  const outcome = completedDriverOutcome();
  const manager = await fakeManager({ socketPath: fixture.socketPath, outcome });
  try {
    const result = await runCli({
      directory: fixture.directory,
      argv: [
        'capsule',
        'exec',
        '--session',
        fixture.sessionId,
        '--driver',
        'public-api',
        '--',
        'curl',
        '/orders',
      ],
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'created\n');
    assert.match(result.stderr, new RegExp(fixtureActivityId, 'u'));
    assert.deepEqual(manager.requests[0], {
      kind: 'exec-request',
      requestId: (manager.requests[0] as { requestId: string }).requestId,
      purpose: 'stimulus',
      target: {
        kind: 'driver',
        driverId: 'public-api',
        argv: ['curl', '/orders'],
        untraced: { kind: 'refuse' },
      },
    });
  } finally {
    await manager.close();
    await removeFixture(fixture.directory);
  }
});

void test('JSON driver execution emits one document and forwards explicit policy flags', async () => {
  const fixture = await commandFixture('running');
  const outcome = completedDriverOutcome();
  const manager = await fakeManager({ socketPath: fixture.socketPath, outcome });
  try {
    const result = await runCli({
      directory: fixture.directory,
      argv: [
        'capsule',
        'exec',
        '--session',
        fixture.sessionId,
        '--driver',
        'public-api',
        '--purpose',
        'inspection',
        '--allow-untraced',
        '--json',
        '--',
        'curl',
        '/orders',
      ],
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      kind: 'capsule-exec-completed',
      activityId: fixtureActivityId,
      outcome,
    });
    assert.equal(result.stderr, '');
    assert.deepEqual((manager.requests[0] as { target: unknown }).target, {
      kind: 'driver',
      driverId: 'public-api',
      argv: ['curl', '/orders'],
      untraced: { kind: 'allow' },
    });
    assert.equal((manager.requests[0] as { purpose: unknown }).purpose, 'inspection');
  } finally {
    await manager.close();
    await removeFixture(fixture.directory);
  }
});

void test('JSON driver refusal stays parseable and exits unsuccessfully', async () => {
  const fixture = await commandFixture('running');
  const outcome = {
    kind: 'driver-propagation-refused',
    driverId: 'public-api',
    propagation: {
      schemaVersion: 1,
      kind: 'telemetry-propagation-v1',
      expectation: {
        kind: 'w3c-trace-context-propagation',
        carrier: 'http-headers',
      },
      outcome: {
        kind: 'context-injection-failed',
        format: 'w3c-trace-context',
        carrier: 'http-headers',
        message: 'driver did not inject context',
      },
    },
  } as const;
  const manager = await fakeManager({ socketPath: fixture.socketPath, outcome });
  try {
    const result = await runCli({
      directory: fixture.directory,
      argv: [
        'capsule',
        'exec',
        '--session',
        fixture.sessionId,
        '--driver',
        'public-api',
        '--json',
        '--',
        'curl',
        '/orders',
      ],
    });
    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stdout), {
      kind: 'capsule-exec-completed',
      activityId: fixtureActivityId,
      outcome,
    });
    assert.equal(result.stderr, '');
  } finally {
    await manager.close();
    await removeFixture(fixture.directory);
  }
});

void test('removed participant and client selectors are rejected', async () => {
  const fixture = await commandFixture('running');
  try {
    for (const selector of ['--participant', '--client']) {
      const result = await runCli({
        directory: fixture.directory,
        argv: [
          'capsule',
          'exec',
          '--session',
          fixture.sessionId,
          selector,
          'legacy',
          '--',
          'true',
        ],
      });
      assert.equal(result.status, 2);
      assert.equal(result.stdout, '');
    }
  } finally {
    await removeFixture(fixture.directory);
  }
});

void test('allow-untraced cannot weaken a raw host activity', async () => {
  const fixture = await commandFixture('running');
  try {
    const result = await runCli({
      directory: fixture.directory,
      argv: [
        'capsule',
        'exec',
        '--session',
        fixture.sessionId,
        '--allow-untraced',
        '--',
        'true',
      ],
    });
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /--allow-untraced requires --driver/u);
  } finally {
    await removeFixture(fixture.directory);
  }
});
