import {
  emitProgress,
  progressCoordinates,
  type SandboxProgressMode,
} from '../acquisition/progress.js';
import {
  recordedError,
  writeSandboxRecord,
  type ActiveSandboxRecord,
  type FailedSandboxRecord,
} from '../ownership/records.js';
import type { SandboxInput, SandboxLifecycleEvent } from '../types.js';
import {
  asError,
  SandboxStartError,
  type CleanupOutcome,
  type RecordWriteOutcome,
} from './errors.js';
import { cleanupRecord, emitLifecycle } from './helpers.js';

export async function failSandboxStart(input: {
  readonly sandbox: SandboxInput;
  readonly record: ActiveSandboxRecord;
  readonly cause: unknown;
  readonly cleanup: CleanupOutcome;
  readonly progress: SandboxProgressMode;
  readonly now: () => Date;
  readonly onEvent: (event: SandboxLifecycleEvent) => void;
}): Promise<never> {
  const startupError = asError(input.cause);
  emitProgress({
    mode: input.progress,
    event: {
      kind: 'acquisition-failed',
      ...progressCoordinates({ source: input.record, now: input.now }),
      error: { name: startupError.name, message: startupError.message },
    },
  });
  const failed = failedRecord({ ...input, startupError });
  const initial = { kind: 'written' } satisfies RecordWriteOutcome;
  let recordOutcome: RecordWriteOutcome = initial;
  try {
    await writeSandboxRecord({ recordDirectory: input.sandbox.recordDirectory, record: failed });
    emitLifecycle({ onEvent: input.onEvent, record: failed });
  } catch (cause) {
    recordOutcome = { kind: 'failed', error: asError(cause) };
  }
  throw new SandboxStartError({
    failure: {
      kind: 'start-failed',
      startupError,
      cleanup: input.cleanup,
      record: recordOutcome,
    },
  });
}

function failedRecord(input: {
  readonly record: ActiveSandboxRecord;
  readonly startupError: Error;
  readonly cleanup: CleanupOutcome;
  readonly now: () => Date;
}): FailedSandboxRecord {
  return {
    ...input.record,
    state: 'start-failed',
    revision: input.record.revision + 1,
    updatedAt: input.now().toISOString(),
    primaryError: recordedError(input.startupError),
    cleanup: cleanupRecord(input.cleanup),
  };
}
