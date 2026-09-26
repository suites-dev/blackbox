import { expect, it } from 'vitest';

import { managerRequest } from '../../ipc/client.js';
import { readCapsuleActivities, readCapsuleRecord } from '../../records.js';
import { requestFixture } from './request.fixture.js';

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!(await predicate())) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for manager test condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function connections(fixture: Awaited<ReturnType<typeof requestFixture>>): Promise<number> {
  return new Promise((resolve, reject) => {
    fixture.manager.server.getConnections((error, count) => {
      if (error === null) {
        resolve(count);
      } else {
        reject(error);
      }
    });
  });
}

it('persists real host output and its execution scope before acknowledging execution', async () => {
  const fixture = await requestFixture(() => Promise.resolve());
  try {
    const host = await managerRequest({
      socketPath: fixture.socketPath,
      request: {
        kind: 'exec-request',
        requestId: 'host-1',
        name: { kind: 'provided', value: '  Create subscription  ' },
        purpose: 'stimulus',
        target: {
          kind: 'host',
          argv: [
            process.execPath,
            '-e',
            'process.stdout.write(process.env.BLACKBOX_CAPSULE_SESSION_ID)',
          ],
        },
      },
    });
    expect(host).toMatchObject({
      kind: 'exec-response',
      requestId: 'host-1',
      outcome: {
        kind: 'exited',
        stdout: fixture.sessionId,
        exitCode: 0,
        propagation: {
          kind: 'telemetry-propagation-v1',
          expectation: { kind: 'propagation-not-requested' },
          outcome: { kind: 'context-not-injected', reason: 'raw-command' },
        },
      },
    });
    if (host.kind !== 'exec-response') {
      throw new Error(`Expected exec response, received ${host.kind}`);
    }
    const activities = await readCapsuleActivities(fixture);
    expect(activities).toMatchObject([
      {
        activityId: host.activityId,
        sequence: 1,
        name: { kind: 'provided', value: 'Create subscription' },
        purpose: 'stimulus',
        target: { kind: 'host' },
        outcome: {
          stdout: fixture.sessionId,
          propagation: { kind: 'telemetry-propagation-v1' },
        },
        telemetry: { kind: 'telemetry-execution-scope-completed-v1' },
      },
    ]);
  } finally {
    await fixture.close();
  }
});

it('unknown drivers fail and missing host executables produce retained outcomes', async () => {
  const fixture = await requestFixture(() => Promise.resolve());
  try {
    const unknown = await managerRequest({
      socketPath: fixture.socketPath,
      request: {
        kind: 'exec-request',
        requestId: 'unknown-1',
        name: { kind: 'omitted' },
        purpose: 'inspection',
        target: {
          kind: 'driver',
          driverId: 'foreign-driver',
          argv: ['true'],
          untraced: { kind: 'refuse' },
        },
      },
    });
    expect(unknown).toMatchObject({
      kind: 'manager-error-response',
      requestId: 'unknown-1',
      error: { message: 'Unknown driver "foreign-driver"' },
    });
    const spawnFailure = await managerRequest({
      socketPath: fixture.socketPath,
      request: {
        kind: 'exec-request',
        requestId: 'spawn-1',
        name: { kind: 'omitted' },
        purpose: 'setup',
        target: { kind: 'host', argv: ['/missing/blackbox-command'] },
      },
    });
    expect(spawnFailure).toMatchObject({
      kind: 'exec-response',
      requestId: 'spawn-1',
      outcome: { kind: 'executable-not-found', location: { kind: 'host' } },
    });
    expect(await readCapsuleActivities(fixture)).toMatchObject([
      {
        kind: 'failed',
        sequence: 1,
        target: { kind: 'driver', driverId: 'foreign-driver' },
        error: { message: 'Unknown driver "foreign-driver"' },
      },
      {
        kind: 'completed',
        sequence: 2,
        target: { kind: 'host' },
        outcome: { kind: 'executable-not-found' },
      },
    ]);
  } finally {
    await fixture.close();
  }
});

it('serializes overlapping exec and stop requests without losing activities', async () => {
  const fixture = await requestFixture(() => Promise.resolve());
  const execute = (requestId: string, value: string, delay: number) =>
    managerRequest({
      socketPath: fixture.socketPath,
      request: {
        kind: 'exec-request',
        requestId,
        name: { kind: 'omitted' },
        purpose: 'stimulus',
        target: {
          kind: 'host',
          argv: [
            process.execPath,
            '-e',
            'setTimeout(() => process.stdout.write(process.argv[1]), Number(process.argv[2]))',
            value,
            String(delay),
          ],
        },
      },
    });
  try {
    const first = execute('overlap-1', 'first', 250);
    await waitFor(async () => {
      const activities = await readCapsuleActivities(fixture);
      return activities.length > 0 && activities[0].kind === 'running';
    });
    const second = execute('overlap-2', 'second', 0);
    await waitFor(async () => (await connections(fixture)) === 2);
    const stop = managerRequest({
      socketPath: fixture.socketPath,
      request: { kind: 'stop-request', requestId: 'overlap-stop', reason: 'completed' },
    });
    await waitFor(async () => (await connections(fixture)) === 3);
    const late = execute('overlap-late', 'late', 0);
    await waitFor(async () => (await connections(fixture)) === 4);
    const [firstResult, secondResult, stopResult, lateResult] = await Promise.all([
      first,
      second,
      stop,
      late,
    ]);
    expect(firstResult).toMatchObject({ kind: 'exec-response', outcome: { stdout: 'first' } });
    expect(secondResult).toMatchObject({ kind: 'exec-response', outcome: { stdout: 'second' } });
    expect(stopResult).toMatchObject({ kind: 'stop-response', cleanup: 'complete' });
    expect(lateResult).toMatchObject({
      kind: 'manager-error-response',
      error: { message: 'Cannot execute against Capsule in stopped state' },
    });
    expect(await readCapsuleActivities(fixture)).toMatchObject([
      { kind: 'completed', sequence: 1, outcome: { stdout: 'first' } },
      { kind: 'completed', sequence: 2, outcome: { stdout: 'second' } },
    ]);
  } finally {
    await fixture.close();
  }
});

it('stop forwards the reason and persists cleanup before acknowledgement', async () => {
  const reasons: string[] = [];
  const fixture = await requestFixture((input) => {
    reasons.push(input.reason);
    return Promise.resolve();
  });
  try {
    const result = await managerRequest({
      socketPath: fixture.socketPath,
      request: { kind: 'stop-request', requestId: 'stop-1', reason: 'cancelled' },
    });
    expect(result).toEqual({ kind: 'stop-response', requestId: 'stop-1', cleanup: 'complete' });
    expect(reasons).toEqual(['cancelled']);
    expect(await readCapsuleRecord(fixture)).toMatchObject({
      state: 'stopped',
      cleanup: { kind: 'complete' },
      revision: 3,
    });
  } finally {
    await fixture.close();
  }
});

it('records failed cleanup truthfully when sandbox stop rejects', async () => {
  const fixture = await requestFixture(() =>
    Promise.reject(new Error('owned container is still running')),
  );
  try {
    const result = await managerRequest({
      socketPath: fixture.socketPath,
      request: { kind: 'stop-request', requestId: 'stop-failed', reason: 'failed' },
    });
    expect(result).toMatchObject({
      kind: 'manager-error-response',
      requestId: 'stop-failed',
      error: { message: 'owned container is still running' },
    });
    expect(await readCapsuleRecord(fixture)).toMatchObject({
      state: 'stop-failed',
      cleanup: { kind: 'failed', error: { message: 'owned container is still running' } },
    });
  } finally {
    await fixture.close();
  }
});
