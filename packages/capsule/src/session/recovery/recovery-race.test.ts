import { expect, it, vi } from 'vitest';

import type { CapsuleSessionRecord } from '../../records.js';
import {
  reconcileDeadCapsuleManagerWithPorts,
  type CapsuleManagerRecoveryPorts,
} from './index.js';

const running = {
  schemaVersion: 1,
  sessionId: 'quiet-river-ada',
  executionId: '11111111-1111-4111-8111-111111111111',
  system: 'orders',
  title: 'Orders experiment',
  description: { kind: 'omitted' },
  state: 'running',
  revision: 4,
  admittedAt: '2026-09-25T09:00:00.000Z',
  updatedAt: '2026-09-25T09:01:00.000Z',
  manager: { kind: 'started', pid: 42_424 },
  socketPath: '/project/manager.sock',
  entrypoint: { kind: 'unavailable' },
  containers: [],
  cleanup: { kind: 'not-attempted' },
  failure: { kind: 'none' },
  composeProject: { kind: 'unavailable' },
  artifactRoot: '/project/.blackbox/experiments/capsule-quiet-river-ada',
  networks: [],
  volumes: [],
  readiness: { kind: 'unavailable' },
} satisfies CapsuleSessionRecord;

function processError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

it('does not overwrite a terminal record written during the liveness check', async () => {
  const stopped = {
    ...running,
    state: 'stopped',
    revision: running.revision + 1,
    cleanup: { kind: 'complete' },
  } satisfies CapsuleSessionRecord;
  const readRecord = vi
    .fn<CapsuleManagerRecoveryPorts['readRecord']>()
    .mockResolvedValueOnce(running)
    .mockResolvedValueOnce(stopped);
  const writeActivities = vi.fn<CapsuleManagerRecoveryPorts['writeActivities']>();
  const writeRecord = vi.fn<CapsuleManagerRecoveryPorts['writeRecord']>();

  await expect(
    reconcileDeadCapsuleManagerWithPorts(
      { projectDirectory: '/project', sessionId: running.sessionId },
      {
        now: () => '2026-09-25T10:00:00.000Z',
        signal: () => { throw processError('ESRCH'); },
        readRecord,
        readActivities: () => Promise.resolve([]),
        writeActivities,
        writeRecord,
        recoverSandbox: () => Promise.reject(new Error('must not recover after race loss')),
      },
    ),
  ).resolves.toMatchObject({
    kind: 'capsule-manager-reconciliation-skipped',
    reason: 'terminal-session',
    record: { state: 'stopped', cleanup: { kind: 'complete' } },
  });
  expect(writeActivities).not.toHaveBeenCalled();
  expect(writeRecord).not.toHaveBeenCalled();
});
