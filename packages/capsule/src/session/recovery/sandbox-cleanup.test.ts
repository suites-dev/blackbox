import { expect, it, vi } from 'vitest';

import type {
  CompletedSandboxRecord,
  StopFailedSandboxRecord,
} from '@suites/blackbox-sandbox-internal';

import type { CapsuleSessionRecord } from '../../records.js';
import {
  retryManagerFailedCleanupWithPorts,
  type CapsuleCleanupRecoveryPorts,
} from './sandbox-cleanup.js';
import { runningRecord } from './recovery.fixture.js';

const sandboxFailure = {
  schemaVersion: 1,
  sandboxId: '11111111-1111-4111-8111-111111111111',
  projectName: 'bb-orders',
  composeFiles: ['/project/compose.yaml'],
  state: 'stop-failed',
  revision: 3,
  admittedAt: '2026-09-25T09:00:00.000Z',
  updatedAt: '2026-09-25T10:00:00.000Z',
  primaryError: { name: 'DockerError', message: 'first cleanup failed' },
  cleanup: {
    kind: 'failed',
    error: { name: 'DockerError', message: 'first cleanup failed' },
  },
} satisfies StopFailedSandboxRecord;

const sandboxRecovered = {
  schemaVersion: 1,
  sandboxId: sandboxFailure.sandboxId,
  projectName: sandboxFailure.projectName,
  composeFiles: sandboxFailure.composeFiles,
  state: 'completed',
  revision: 4,
  admittedAt: sandboxFailure.admittedAt,
  updatedAt: '2026-09-25T10:01:00.000Z',
  stopReason: 'interrupted',
  cleanup: 'complete',
} satisfies CompletedSandboxRecord;

it('retains a failed retry and allows the next explicit retry to complete cleanup', async () => {
  const initial = {
    ...runningRecord('/project'),
    state: 'manager-failed',
    cleanup: {
      kind: 'failed',
      error: { name: 'DockerError', message: 'automatic cleanup failed' },
    },
    failure: {
      kind: 'recorded',
      error: { name: 'CapsuleManagerUnavailable', message: 'manager exited' },
    },
  } satisfies CapsuleSessionRecord;
  let record: CapsuleSessionRecord = initial;
  const recoverSandbox = vi.fn<CapsuleCleanupRecoveryPorts['recoverSandbox']>()
    .mockResolvedValueOnce({
      kind: 'sandbox-recovery-failed',
      record: sandboxFailure,
      error: sandboxFailure.cleanup.error,
    })
    .mockResolvedValueOnce({ kind: 'sandbox-recovered', record: sandboxRecovered });
  const ports = {
    readRecord: () => Promise.resolve(record),
    writeRecord: (input) => {
      record = input.record;
      return Promise.resolve();
    },
    recoverSandbox,
  } satisfies CapsuleCleanupRecoveryPorts;
  const selector = { projectDirectory: '/project', sessionId: record.sessionId };

  await expect(retryManagerFailedCleanupWithPorts(selector, ports)).resolves.toMatchObject({
    state: 'manager-failed',
    revision: 5,
    cleanup: { kind: 'failed', error: { message: 'first cleanup failed' } },
  });
  await expect(retryManagerFailedCleanupWithPorts(selector, ports)).resolves.toMatchObject({
    state: 'manager-failed',
    revision: 6,
    cleanup: { kind: 'complete' },
  });
  expect(recoverSandbox).toHaveBeenCalledTimes(2);
  expect(record).toMatchObject({
    failure: { kind: 'recorded', error: { name: 'CapsuleManagerUnavailable' } },
    cleanup: { kind: 'complete' },
  });
});
