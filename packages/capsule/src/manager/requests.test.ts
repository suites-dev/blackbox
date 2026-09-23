import { expect, it } from 'vitest';

import { managerRequest } from '../ipc/client.js';
import { readCapsuleActivities, readCapsuleRecord } from '../records.js';
import { requestFixture } from './request.fixture.js';

it('persists real host output and injected participant output before acknowledging execution', async () => {
  const fixture = await requestFixture(() => Promise.resolve());
  try {
    const host = await managerRequest({ socketPath: fixture.socketPath, request: {
      kind: 'exec-request', requestId: 'host-1', target: { kind: 'host', argv: [process.execPath, '-e', 'process.stdout.write(process.env.BLACKBOX_CAPSULE_SESSION_ID)'] },
    } });
    expect(host).toMatchObject({ kind: 'exec-response', requestId: 'host-1', outcome: { kind: 'exited', stdout: fixture.sessionId, exitCode: 0 } });
    const participant = await managerRequest({ socketPath: fixture.socketPath, request: {
      kind: 'exec-request', requestId: 'db-1', target: { kind: 'participant', participant: 'postgres', argv: ['psql', '--version'] },
    } });
    expect(participant).toMatchObject({ kind: 'exec-response', requestId: 'db-1', outcome: { kind: 'exited', stdout: 'participant-output', exitCode: 7 } });
    expect(await readCapsuleActivities(fixture)).toMatchObject([
      { sequence: 1, target: 'host', outcome: { stdout: fixture.sessionId } },
      { sequence: 2, target: 'participant', participant: 'postgres', argv: ['psql', '--version'], outcome: { exitCode: 7 } },
    ]);
  } finally { await fixture.close(); }
});

it('unknown participants and spawn failures return explicit manager errors', async () => {
  const fixture = await requestFixture(() => Promise.resolve());
  try {
    const unknown = await managerRequest({ socketPath: fixture.socketPath, request: {
      kind: 'exec-request', requestId: 'unknown-1', target: { kind: 'participant', participant: 'foreign-container', argv: ['true'] },
    } });
    expect(unknown).toMatchObject({ kind: 'manager-error-response', requestId: 'unknown-1', error: { message: 'Unknown participant "foreign-container"' } });
    const spawnFailure = await managerRequest({ socketPath: fixture.socketPath, request: {
      kind: 'exec-request', requestId: 'spawn-1', target: { kind: 'host', argv: ['/missing/blackbox-command'] },
    } });
    expect(spawnFailure).toMatchObject({ kind: 'manager-error-response', requestId: 'spawn-1', error: { message: expect.stringContaining('ENOENT') } });
  } finally { await fixture.close(); }
});

it('stop forwards the reason and persists cleanup before acknowledgement', async () => {
  const reasons: string[] = [];
  const fixture = await requestFixture((input) => { reasons.push(input.reason); return Promise.resolve(); });
  try {
    const result = await managerRequest({ socketPath: fixture.socketPath, request: { kind: 'stop-request', requestId: 'stop-1', reason: 'cancelled' } });
    expect(result).toEqual({ kind: 'stop-response', requestId: 'stop-1', cleanup: 'complete' });
    expect(reasons).toEqual(['cancelled']);
    expect(await readCapsuleRecord(fixture)).toMatchObject({ state: 'stopped', cleanup: { kind: 'complete' }, revision: 3 });
  } finally { await fixture.close(); }
});

it('records failed cleanup truthfully when sandbox stop rejects', async () => {
  const fixture = await requestFixture(() => Promise.reject(new Error('owned container is still running')));
  try {
    const result = await managerRequest({ socketPath: fixture.socketPath, request: { kind: 'stop-request', requestId: 'stop-failed', reason: 'failed' } });
    expect(result).toMatchObject({ kind: 'manager-error-response', requestId: 'stop-failed', error: { message: 'owned container is still running' } });
    expect(await readCapsuleRecord(fixture)).toMatchObject({
      state: 'stop-failed', cleanup: { kind: 'failed', error: { message: 'owned container is still running' } },
    });
  } finally { await fixture.close(); }
});
