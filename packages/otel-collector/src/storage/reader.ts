import { readFile, readdir } from 'node:fs/promises';
import type {
  CollectorSessionReadResult,
  CollectorTraceReadResult,
  CollectorLifecycleRecord,
  ReadCollectorSessionInput,
  ReadCollectorTraceInput,
  RetainedFragment,
  RetainedFragmentSummary,
  TraceFragment,
} from '../model/types.js';
import { fragmentDirectory, lifecyclePath } from './paths.js';
import { parseLifecycle } from '../lifecycle/store.js';
import {
  filterTraceRequest,
  traceIdsInRequest,
  validateOtlpTraceRequest,
} from '../otlp/json.js';
import {
  recordedFailure,
  validateIdentity,
  validateTraceId,
} from '../model/validation.js';

export function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function parseFragment(input: {
  readonly text: string;
  readonly identity: ReadCollectorSessionInput;
  readonly expectedSequence: number;
}): RetainedFragment {
  const value = JSON.parse(input.text) as unknown;
  if (
    typeof value !== 'object' ||
    value === null ||
    !('schemaVersion' in value) ||
    value.schemaVersion !== 1 ||
    !('sessionId' in value) ||
    value.sessionId !== input.identity.sessionId ||
    !('executionId' in value) ||
    value.executionId !== input.identity.executionId ||
    !('sequence' in value) ||
    value.sequence !== input.expectedSequence ||
    !('receivedAt' in value) ||
    typeof value.receivedAt !== 'string' ||
    !('spanCount' in value) ||
    typeof value.spanCount !== 'number' ||
    !('rawJson' in value) ||
    typeof value.rawJson !== 'string' ||
    !('contentType' in value) ||
    value.contentType !== 'application/json' ||
    !('contentEncoding' in value) ||
    (value.contentEncoding !== 'identity' && value.contentEncoding !== 'gzip')
  ) {
    throw new Error(`Retained fragment ${String(input.expectedSequence)} is corrupt.`);
  }
  const fragment = value as RetainedFragment;
  const spanCount = validateOtlpTraceRequest(JSON.parse(fragment.rawJson) as unknown);
  if (spanCount !== fragment.spanCount) {
    throw new Error(`Retained fragment ${String(input.expectedSequence)} span count is corrupt.`);
  }
  return fragment;
}

async function fragmentNames(input: ReadCollectorSessionInput): Promise<readonly string[]> {
  const names = await readdir(fragmentDirectory(input));
  return names.filter((name) => /^\d{12}\.json$/u.test(name)).sort();
}

export async function readFragments(
  input: ReadCollectorSessionInput,
): Promise<readonly RetainedFragment[]> {
  const names = await fragmentNames(input);
  return Promise.all(
    names.map(async (name) =>
      parseFragment({
        text: await readFile(`${fragmentDirectory(input)}/${name}`, 'utf8'),
        identity: input,
        expectedSequence: Number.parseInt(name.slice(0, 12), 10),
      }),
    ),
  );
}

export function identity(input: ReadCollectorSessionInput): {
  readonly sessionId: string;
  readonly executionId: string;
} {
  return { sessionId: input.sessionId, executionId: input.executionId };
}

export async function readLifecycle(
  input: ReadCollectorSessionInput,
): Promise<CollectorLifecycleRecord> {
  return parseLifecycle({ text: await readFile(lifecyclePath(input), 'utf8'), identity: input });
}

export function assertInventory(input: {
  readonly lifecycle: CollectorLifecycleRecord;
  readonly fragments: readonly RetainedFragment[];
}): void {
  const contiguous = input.fragments.every((fragment, index) => fragment.sequence === index + 1);
  const spans = input.fragments.reduce((total, fragment) => total + fragment.spanCount, 0);
  if (
    !contiguous ||
    input.fragments.length < input.lifecycle.telemetry.acceptedRequests ||
    spans < input.lifecycle.telemetry.acceptedSpans
  ) {
    throw new Error('Retained fragment inventory is incomplete for the acknowledged telemetry.');
  }
}

export async function readCollectorSession(
  input: ReadCollectorSessionInput,
): Promise<CollectorSessionReadResult> {
  validateIdentity(input);
  let lifecycle: CollectorLifecycleRecord;
  try {
    lifecycle = await readLifecycle(input);
  } catch (error) {
    if (isMissing(error)) {
      return {
        kind: 'collector-session-missing',
        identity: identity(input),
        message: 'No retained collector session exists for the exact identity.',
      };
    }
    return {
      kind: 'collector-session-corrupt',
      identity: identity(input),
      error: recordedFailure(error),
    };
  }
  try {
    const retained = await readFragments(input);
    assertInventory({ lifecycle, fragments: retained });
    const fragments = retained.map(
      (fragment) =>
        ({
          sequence: fragment.sequence,
          receivedAt: fragment.receivedAt,
          spanCount: fragment.spanCount,
        }) satisfies RetainedFragmentSummary,
    );
    const traceIds = [
      ...new Set(
        retained.flatMap((fragment) => traceIdsInRequest(JSON.parse(fragment.rawJson) as unknown)),
      ),
    ].sort();
    return { kind: 'collector-session-found', lifecycle, fragments, traceIds };
  } catch (error) {
    return {
      kind: 'collector-session-corrupt',
      identity: identity(input),
      error: recordedFailure(error),
    };
  }
}

export async function readCollectorTrace(
  input: ReadCollectorTraceInput,
): Promise<CollectorTraceReadResult> {
  validateIdentity(input);
  const traceId = validateTraceId(input.traceId);
  let lifecycle: CollectorLifecycleRecord;
  try {
    lifecycle = await readLifecycle(input);
  } catch (error) {
    if (isMissing(error)) {
      return {
        kind: 'collector-trace-missing',
        identity: identity(input),
        traceId,
        message: 'No retained collector session exists for the exact identity.',
      };
    }
    return {
      kind: 'collector-trace-corrupt',
      identity: identity(input),
      traceId,
      error: recordedFailure(error),
    };
  }
  try {
    const retained = await readFragments(input);
    assertInventory({ lifecycle, fragments: retained });
    const fragments: TraceFragment[] = [];
    for (const fragment of retained) {
      const request = JSON.parse(fragment.rawJson) as unknown;
      const filtered = filterTraceRequest({ request, traceId });
      if (filtered !== null) {
        fragments.push({
          sequence: fragment.sequence,
          receivedAt: fragment.receivedAt,
          request: filtered,
        });
      }
    }
    if (fragments.length === 0) {
      return {
        kind: 'collector-trace-missing',
        identity: identity(input),
        traceId,
        message: 'No retained spans exist for the exact trace ID.',
      };
    }
    return { kind: 'collector-trace-found', identity: identity(input), traceId, fragments };
  } catch (error) {
    return {
      kind: 'collector-trace-corrupt',
      identity: identity(input),
      traceId,
      error: recordedFailure(error),
    };
  }
}
