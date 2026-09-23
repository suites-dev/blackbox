import { createHash } from 'node:crypto';
import { recordedError, type FailedSandboxRecord } from '../ownership/records.js';
import type { CleanupOutcome } from './errors.js';
import type { SandboxLifecycleEvent } from '../types.js';

export function composeProjectName(input: { readonly sandboxId: string }): string {
  const slug = input.sandboxId
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 32);
  const digest = createHash('sha256').update(input.sandboxId).digest('hex').slice(0, 16);
  return `bb-${slug}-${digest}`;
}

export function withTimeout<T>(input: {
  readonly operation: Promise<T>;
  readonly timeoutMs: number;
  readonly label: string;
}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${input.label} timed out after ${input.timeoutMs}ms`));
    }, input.timeoutMs);
    input.operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export function cleanupRecord(outcome: CleanupOutcome): FailedSandboxRecord['cleanup'] {
  switch (outcome.kind) {
    case 'not-attempted':
      return { kind: 'not-attempted' };
    case 'complete':
      return { kind: 'complete' };
    case 'failed':
      return { kind: 'failed', error: recordedError(outcome.error) };
  }
}

export function emitLifecycle(input: {
  readonly onEvent: (event: SandboxLifecycleEvent) => void;
  readonly record: SandboxRecordEvent;
}): void {
  try {
    input.onEvent({
      sandboxId: input.record.sandboxId,
      projectName: input.record.projectName,
      state: input.record.state,
      revision: input.record.revision,
      at: input.record.updatedAt,
    });
  } catch {
    // The durable record remains authoritative when a presentation hook fails.
  }
}

interface SandboxRecordEvent {
  readonly sandboxId: string;
  readonly projectName: string;
  readonly state: SandboxLifecycleEvent['state'];
  readonly revision: number;
  readonly updatedAt: string;
}
