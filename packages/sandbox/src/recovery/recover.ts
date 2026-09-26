import {
  readSandboxRecord,
  recordedError,
  writeSandboxRecord,
  type SandboxRecord,
  type StartFailedSandboxRecord,
  type StopFailedSandboxRecord,
} from '../ownership/records.js';
import { cleanupOwnedComposeProject } from './cleanup.js';
import { createComposeRecoveryClient } from './docker-client.js';
import type {
  RecoverSandboxInput,
  SandboxRecoveryPorts,
  SandboxRecoveryResult,
} from './types.js';

function isMissingRecord(error: unknown): boolean {
  return typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'ENOENT';
}

function alreadyClean(record: SandboxRecord): boolean {
  return record.state === 'completed' ||
    (record.state === 'start-failed' && record.cleanup.kind === 'complete');
}

function recoveredRecord(record: SandboxRecord, now: Date):
  | Extract<SandboxRecord, { readonly state: 'completed' }>
  | StartFailedSandboxRecord {
  if (record.state === 'start-failed') {
    return {
      ...record,
      revision: record.revision + 1,
      updatedAt: now.toISOString(),
      cleanup: { kind: 'complete' },
    };
  }
  return {
    ...record,
    state: 'completed',
    revision: record.revision + 1,
    updatedAt: now.toISOString(),
    stopReason: 'interrupted',
    cleanup: 'complete',
  };
}

function failedRecord(
  record: SandboxRecord,
  error: unknown,
  now: Date,
): StopFailedSandboxRecord {
  const failure = recordedError(error);
  const primaryError = record.state === 'start-failed' || record.state === 'stop-failed'
    ? record.primaryError
    : failure;
  return {
    ...record,
    state: 'stop-failed',
    revision: record.revision + 1,
    updatedAt: now.toISOString(),
    primaryError,
    cleanup: { kind: 'failed', error: failure },
  };
}

export async function recoverSandboxWithPorts(
  input: RecoverSandboxInput,
  ports: SandboxRecoveryPorts,
): Promise<SandboxRecoveryResult> {
  let record: SandboxRecord;
  try {
    record = await ports.readRecord(input);
  } catch (error) {
    if (isMissingRecord(error)) {
      return {
        kind: 'sandbox-recovery-not-required',
        reason: 'record-not-found',
        record: { kind: 'unavailable' },
      };
    }
    throw error;
  }
  if (alreadyClean(record)) {
    return {
      kind: 'sandbox-recovery-not-required',
      reason: 'already-clean',
      record: { kind: 'available', value: record },
    };
  }
  try {
    await ports.cleanupOwnedComposeProject({
      projectName: record.projectName,
      timeoutMs: input.timeoutMs,
    });
  } catch (error) {
    const failed = failedRecord(record, error, ports.now());
    try {
      await ports.writeRecord({ recordDirectory: input.recordDirectory, record: failed });
    } catch (recordError) {
      throw new AggregateError(
        [error, recordError],
        'Sandbox recovery cleanup and failure retention both failed',
      );
    }
    return { kind: 'sandbox-recovery-failed', record: failed, error: failed.cleanup.error };
  }
  const recovered = recoveredRecord(record, ports.now());
  await ports.writeRecord({ recordDirectory: input.recordDirectory, record: recovered });
  return { kind: 'sandbox-recovered', record: recovered };
}

export async function recoverSandbox(
  input: RecoverSandboxInput,
): Promise<SandboxRecoveryResult> {
  return recoverSandboxWithPorts(input, {
    now: () => new Date(),
    readRecord: readSandboxRecord,
    writeRecord: writeSandboxRecord,
    cleanupOwnedComposeProject: async (cleanup) => {
      const client = await createComposeRecoveryClient();
      await cleanupOwnedComposeProject({ cleanup, client });
    },
  });
}
