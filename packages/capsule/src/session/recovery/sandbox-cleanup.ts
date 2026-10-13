import {
  recoverSandbox,
  type SandboxRecoveryResult,
} from '@suites/blackbox-sandbox';

import {
  capsuleSandboxRecordDirectory,
  readCapsuleRecord,
  recordedError,
  writeCapsuleRecord,
  type CapsuleSessionRecord,
  type CapsuleSessionSelector,
} from '../../records.js';
import type { CapsuleCleanupReport } from '../../model/lifecycle.js';

// The cleanup report of an attempted cleanup, the shape the record stores.
type CapsuleCleanup = Exclude<CapsuleCleanupReport, { readonly kind: 'not-attempted' }>;

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

/**
 * `down` on a capsule whose manager is gone: retries the cleanup unless it is
 * already complete, and records the capsule stopped once it is. The recorded
 * failure stays, so the report still says why the manager went away.
 */
export async function retryManagerFailedCleanupWithPorts(
  input: CapsuleSessionSelector,
  ports: CapsuleCleanupRecoveryPorts,
): Promise<CapsuleSessionRecord> {
  const record = await ports.readRecord(input);
  if (record.state !== 'manager-failed') {
    return record;
  }
  const cleanup = record.cleanup.kind === 'complete'
    ? record.cleanup
    : await cleanupAfterManagerDeath({ selector: input, record, recover: ports.recoverSandbox });
  const current = await ports.readRecord(input);
  if (current.state !== 'manager-failed') {
    return current;
  }
  const outcome = current.cleanup.kind === 'complete' ? current.cleanup : cleanup;
  const recovered = {
    ...current,
    state: outcome.kind === 'complete' ? 'stopped' : 'manager-failed',
    revision: current.revision + 1,
    updatedAt: new Date().toISOString(),
    cleanup: outcome,
  } satisfies CapsuleSessionRecord;
  await ports.writeRecord({ projectDirectory: input.projectDirectory, record: recovered });
  return recovered;
}

export function retryManagerFailedCleanup(
  input: CapsuleSessionSelector,
): Promise<CapsuleSessionRecord> {
  return retryManagerFailedCleanupWithPorts(input, productionPorts);
}
