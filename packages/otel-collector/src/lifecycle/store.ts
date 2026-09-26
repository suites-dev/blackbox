import { readFile, readdir } from 'node:fs/promises';
import type {
  CollectorEndpoint,
  CollectorLifecycleRecord,
  CollectorRunRecord,
} from '../model/types.js';
import type { CollectorStorageLease } from '../storage/lease.js';
import { fragmentDirectory, lifecyclePath } from '../storage/paths.js';
import { RunningCollectorStore, type CollectorStore } from './running-store.js';
import { retainedUsage, type CollectorRetentionLimits } from './retention.js';

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validFailure(value: unknown): boolean {
  return (
    value === null ||
    (isRecord(value) &&
      typeof value.name === 'string' &&
      typeof value.message === 'string' &&
      value.message !== '')
  );
}
function validEndpoint(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.kind === 'http' &&
    typeof value.host === 'string' &&
    Number.isInteger(value.port) &&
    typeof value.baseUrl === 'string' &&
    typeof value.tracesPath === 'string' &&
    typeof value.tracesUrl === 'string' &&
    typeof value.activationPath === 'string' &&
    typeof value.activationUrl === 'string' &&
    typeof value.readinessPath === 'string' &&
    typeof value.readinessUrl === 'string' &&
    typeof value.readPath === 'string' &&
    typeof value.readUrl === 'string'
  );
}

function validRun(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const receivers = ['ready', 'draining', 'stopped', 'failed', 'interrupted'];
  const shutdowns = ['not-started', 'draining', 'complete', 'timed-out', 'interrupted'];
  return (
    typeof value.instanceId === 'string' &&
    typeof value.startedAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    (value.stoppedAt === null || typeof value.stoppedAt === 'string') &&
    typeof value.receiver === 'string' &&
    receivers.includes(value.receiver) &&
    validInstrumentation(value.instrumentation) &&
    typeof value.shutdown === 'string' &&
    shutdowns.includes(value.shutdown) &&
    validFailure(value.failure) &&
    validEndpoint(value.endpoint)
  );
}

function validInstrumentation(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (value.kind === 'not-activated') {
    return Object.keys(value).length === 1;
  }
  return (
    value.kind === 'activated' &&
    Array.isArray(value.activations) &&
    value.activations.length > 0 &&
    value.activations.every(
      (activation) =>
        isRecord(activation) &&
        activation.kind === 'instrumentation-activation' &&
        typeof activation.runtime === 'string' &&
        activation.runtime !== '' &&
        typeof activation.serviceName === 'string' &&
        activation.serviceName !== '' &&
        typeof activation.activatedAt === 'string',
    )
  );
}

function validTelemetry(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const countsAreValid =
    Number.isSafeInteger(value.acceptedRequests) &&
    Number(value.acceptedRequests) >= 0 &&
    Number.isSafeInteger(value.acceptedSpans) &&
    Number(value.acceptedSpans) >= 0;
  if (!countsAreValid) {
    return false;
  }
  if (value.status === 'not-received') {
    return (
      value.acceptedRequests === 0 && value.acceptedSpans === 0 && value.lastReceivedAt === null
    );
  }
  return (
    value.status === 'received' &&
    Number(value.acceptedRequests) > 0 &&
    typeof value.lastReceivedAt === 'string'
  );
}

export function parseLifecycle(input: {
  readonly text: string;
  readonly identity: { readonly sessionId: string; readonly executionId: string };
}): CollectorLifecycleRecord {
  const value = JSON.parse(input.text) as unknown;
  if (
    typeof value !== 'object' ||
    value === null ||
    !('schemaVersion' in value) ||
    value.schemaVersion !== 1
  ) {
    throw new Error('Retained collector lifecycle has an unsupported shape.');
  }
  if (
    !('sessionId' in value) ||
    value.sessionId !== input.identity.sessionId ||
    !('executionId' in value) ||
    value.executionId !== input.identity.executionId
  ) {
    throw new Error(
      'Retained collector lifecycle identity does not match the requested session and execution.',
    );
  }
  if (
    !('revision' in value) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 1 ||
    !('runs' in value) ||
    !Array.isArray(value.runs) ||
    value.runs.length === 0 ||
    !value.runs.every(validRun) ||
    !('telemetry' in value) ||
    !validTelemetry(value.telemetry)
  ) {
    throw new Error('Retained collector lifecycle is corrupt.');
  }
  return value as CollectorLifecycleRecord;
}

async function previousLifecycle(
  lease: CollectorStorageLease,
): Promise<CollectorLifecycleRecord | null> {
  try {
    return parseLifecycle({ text: await readFile(lifecyclePath(lease), 'utf8'), identity: lease });
  } catch (error) {
    if (isMissing(error)) {
      return null;
    }
    throw error;
  }
}

function interruptActiveRun(
  record: CollectorLifecycleRecord,
  now: string,
): readonly CollectorRunRecord[] {
  return record.runs.map((run, index) => {
    if (
      index !== record.runs.length - 1 ||
      (run.receiver !== 'ready' && run.receiver !== 'draining')
    ) {
      return run;
    }
    return {
      ...run,
      receiver: 'interrupted',
      shutdown: 'interrupted',
      stoppedAt: now,
      updatedAt: now,
      failure: {
        name: 'CollectorInterrupted',
        message: 'The prior collector lifecycle ended without a graceful close record.',
      },
    };
  });
}

function initialRecord(input: {
  readonly lease: CollectorStorageLease;
  readonly endpoint: CollectorEndpoint;
  readonly instanceId: string;
  readonly previous: CollectorLifecycleRecord | null;
}): CollectorLifecycleRecord {
  const now = new Date().toISOString();
  const run = {
    instanceId: input.instanceId,
    startedAt: now,
    updatedAt: now,
    stoppedAt: null,
    receiver: 'ready',
    instrumentation: { kind: 'not-activated' },
    shutdown: 'not-started',
    failure: null,
    endpoint: input.endpoint,
  } satisfies CollectorRunRecord;
  const priorRuns = input.previous === null ? [] : interruptActiveRun(input.previous, now);
  return {
    schemaVersion: 1,
    sessionId: input.lease.sessionId,
    executionId: input.lease.executionId,
    revision: (input.previous === null ? 0 : input.previous.revision) + 1,
    runs: [...priorRuns, run],
    telemetry:
      input.previous === null
        ? { status: 'not-received', acceptedRequests: 0, acceptedSpans: 0, lastReceivedAt: null }
        : input.previous.telemetry,
  };
}

async function findNextSequence(lease: CollectorStorageLease): Promise<number> {
  const names = await readdir(fragmentDirectory(lease));
  const sequences = names
    .filter((name) => /^\d{12}\.json$/u.test(name))
    .map((name) => Number.parseInt(name.slice(0, 12), 10));
  return sequences.length === 0 ? 1 : Math.max(...sequences) + 1;
}

export async function createCollectorStore(input: {
  readonly lease: CollectorStorageLease;
  readonly endpoint: CollectorEndpoint;
  readonly instanceId: string;
  readonly limits: CollectorRetentionLimits;
}): Promise<CollectorStore> {
  const record = initialRecord({ ...input, previous: await previousLifecycle(input.lease) });
  const store = new RunningCollectorStore({
    lease: input.lease,
    record,
    sequence: await findNextSequence(input.lease),
    usage: await retainedUsage(input.lease),
    limits: input.limits,
  });
  await store.initialize();
  return store;
}
export type { CollectorStore } from './running-store.js';
