import { expect, it, vi } from 'vitest';

import type { ActiveSandboxRecord, SandboxRecord } from '../ownership/records.js';
import { composeProjectName } from '../lifecycle/helpers.js';
import { recoverSandboxWithPorts } from './recover.js';
import type { SandboxRecoveryPorts } from './types.js';

const admitted = {
  schemaVersion: 1,
  sandboxId: 'sandbox-1',
  projectName: composeProjectName({ sandboxId: 'sandbox-1' }),
  composeFiles: ['/project/compose.yaml'],
  state: 'running',
  revision: 2,
  admittedAt: '2026-09-25T09:00:00.000Z',
  updatedAt: '2026-09-25T09:01:00.000Z',
} satisfies ActiveSandboxRecord;

function recoveryPorts(input: {
  readonly record: SandboxRecord;
  readonly cleanup: SandboxRecoveryPorts['cleanupOwnedComposeProject'];
}) {
  let record = input.record;
  const writeRecord = vi.fn<SandboxRecoveryPorts['writeRecord']>((write) => {
    record = write.record;
    return Promise.resolve();
  });
  const ports = {
    now: () => new Date('2026-09-25T10:00:00.000Z'),
    readRecord: () => Promise.resolve(record),
    writeRecord,
    cleanupOwnedComposeProject: input.cleanup,
  } satisfies SandboxRecoveryPorts;
  return { ports, writeRecord };
}

it('cleans the exact durable Compose project and records interrupted completion', async () => {
  const cleanup = vi.fn<SandboxRecoveryPorts['cleanupOwnedComposeProject']>(() =>
    Promise.resolve());
  const fixture = recoveryPorts({ record: admitted, cleanup });
  await expect(recoverSandboxWithPorts({
    recordDirectory: '/records',
    sandboxId: admitted.sandboxId,
    timeoutMs: 5000,
  }, fixture.ports)).resolves.toMatchObject({
    kind: 'sandbox-recovered',
    record: {
      state: 'completed',
      stopReason: 'interrupted',
      cleanup: 'complete',
      revision: 3,
    },
  });
  expect(cleanup).toHaveBeenCalledWith({ projectName: admitted.projectName, timeoutMs: 5000 });
  expect(fixture.writeRecord).toHaveBeenCalledOnce();
});

it('retains recovery cleanup failure for later retry', async () => {
  const fixture = recoveryPorts({
    record: admitted,
    cleanup: () => Promise.reject(new Error('Docker unavailable')),
  });
  await expect(recoverSandboxWithPorts({
    recordDirectory: '/records',
    sandboxId: admitted.sandboxId,
    timeoutMs: 5000,
  }, fixture.ports)).resolves.toMatchObject({
    kind: 'sandbox-recovery-failed',
    error: { name: 'Error', message: 'Docker unavailable' },
    record: {
      state: 'stop-failed',
      cleanup: { kind: 'failed', error: { message: 'Docker unavailable' } },
    },
  });
  expect(fixture.writeRecord).toHaveBeenCalledOnce();
});

it('does not contact Docker when Sandbox admission never completed', async () => {
  const cleanup = vi.fn<SandboxRecoveryPorts['cleanupOwnedComposeProject']>();
  const ports = {
    now: () => new Date(),
    readRecord: () => Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' })),
    writeRecord: vi.fn<SandboxRecoveryPorts['writeRecord']>(),
    cleanupOwnedComposeProject: cleanup,
  } satisfies SandboxRecoveryPorts;
  await expect(recoverSandboxWithPorts({
    recordDirectory: '/records',
    sandboxId: admitted.sandboxId,
    timeoutMs: 5000,
  }, ports)).resolves.toMatchObject({
    kind: 'sandbox-recovery-not-required',
    reason: 'record-not-found',
  });
  expect(cleanup).not.toHaveBeenCalled();
});

it('audit F4: recovery rejects mismatched sandbox record identity', async () => {
  const cleanup = vi.fn<SandboxRecoveryPorts['cleanupOwnedComposeProject']>(() =>
    Promise.resolve());
  const fixture = recoveryPorts({ record: admitted, cleanup });
  await expect(recoverSandboxWithPorts({
    recordDirectory: '/records',
    sandboxId: 'other-sandbox',
    timeoutMs: 5000,
  }, fixture.ports)).rejects.toThrow(/sandbox identity/u);
  expect(cleanup).not.toHaveBeenCalled();
});

it('audit F4: recovery rejects a traversal sandboxId before reading any record', async () => {
  const readRecord = vi.fn<SandboxRecoveryPorts['readRecord']>(() => Promise.resolve(admitted));
  const ports = {
    now: () => new Date(),
    readRecord,
    writeRecord: vi.fn<SandboxRecoveryPorts['writeRecord']>(),
    cleanupOwnedComposeProject: vi.fn<SandboxRecoveryPorts['cleanupOwnedComposeProject']>(),
  } satisfies SandboxRecoveryPorts;

  await expect(recoverSandboxWithPorts({
    recordDirectory: '/records',
    sandboxId: '../escape',
    timeoutMs: 5000,
  }, ports)).rejects.toThrow(/sandboxId/u);
  expect(readRecord).not.toHaveBeenCalled();
});
