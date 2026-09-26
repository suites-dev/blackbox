import {
  recoverSandbox,
  type SandboxRecoveryResult,
} from '@suites/blackbox-sandbox-internal';

import {
  capsuleSandboxRecordDirectory,
  readCapsuleRecord,
  recordedError,
  writeCapsuleRecord,
  type CapsuleSessionRecord,
  type CapsuleSessionSelector,
} from '../../records.js';
import type { CapsuleRecordedError } from '../../types.js';

type CapsuleCleanup =
  | { readonly kind: 'complete' }
  | { readonly kind: 'failed'; readonly error: CapsuleRecordedError };

export interface CapsuleCleanupRecoveryPorts {
  readonly readRecord: typeof readCapsuleRecord;
  readonly writeRecord: typeof writeCapsuleRecord;
  readonly recoverSandbox: typeof recoverSandbox;
}

const productionPorts = {
  readRecord: readCapsuleRecord,
  writeRecord: writeCapsuleRecord,
  recoverSandbox,
} satisfies CapsuleCleanupRecoveryPorts;

function recoveryCleanup(result: SandboxRecoveryResult): CapsuleCleanup {
  return result.kind === 'sandbox-recovery-failed'
    ? { kind: 'failed', error: result.error }
    : { kind: 'complete' };
}

export async function cleanupAfterManagerDeath(input: {
  readonly selector: CapsuleSessionSelector;
  readonly record: CapsuleSessionRecord;
  readonly recover: typeof recoverSandbox;
}): Promise<CapsuleCleanup> {
  try {
    return recoveryCleanup(await input.recover({
      recordDirectory: capsuleSandboxRecordDirectory(input.selector),
      sandboxId: input.record.executionId,
      timeoutMs: 60_000,
    }));
  } catch (error) {
    return { kind: 'failed', error: recordedError(error) };
  }
}

export async function retryManagerFailedCleanupWithPorts(
  input: CapsuleSessionSelector,
  ports: CapsuleCleanupRecoveryPorts,
): Promise<CapsuleSessionRecord> {
  const record = await ports.readRecord(input);
  if (record.state !== 'manager-failed' || record.cleanup.kind === 'complete') {
    return record;
  }
  const cleanup = await cleanupAfterManagerDeath({
    selector: input,
    record,
    recover: ports.recoverSandbox,
  });
  const current = await ports.readRecord(input);
  if (current.state !== 'manager-failed' || current.cleanup.kind === 'complete') {
    return current;
  }
  const recovered = {
    ...current,
    revision: current.revision + 1,
    updatedAt: new Date().toISOString(),
    cleanup,
  } satisfies CapsuleSessionRecord;
  await ports.writeRecord({ projectDirectory: input.projectDirectory, record: recovered });
  return recovered;
}

export function retryManagerFailedCleanup(
  input: CapsuleSessionSelector,
): Promise<CapsuleSessionRecord> {
  return retryManagerFailedCleanupWithPorts(input, productionPorts);
}
