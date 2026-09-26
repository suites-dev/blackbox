import type {
  CollectorLifecycleRecord,
  CollectorSnapshotReadResult,
  ReadCollectorSessionInput,
  RetainedFragment,
  RetainedFragmentSummary,
  TraceFragment,
} from '../../model/types.js';
import { recordedFailure, validateIdentity } from '../../model/validation.js';
import { partitionTraceRequest } from '../../otlp/json.js';
import { assertInventory, identity, isMissing, readFragments, readLifecycle } from '../reader.js';

function fragmentSummary(fragment: RetainedFragment): RetainedFragmentSummary {
  return {
    sequence: fragment.sequence,
    receivedAt: fragment.receivedAt,
    spanCount: fragment.spanCount,
  };
}

function traces(retained: readonly RetainedFragment[]) {
  const indexed = new Map<string, TraceFragment[]>();
  for (const fragment of retained) {
    const request = JSON.parse(fragment.rawJson) as unknown;
    for (const [traceId, filtered] of partitionTraceRequest(request)) {
      const traceFragment = {
        sequence: fragment.sequence,
        receivedAt: fragment.receivedAt,
        request: filtered,
      } satisfies TraceFragment;
      const fragments = indexed.get(traceId);
      if (fragments === undefined) {
        indexed.set(traceId, [traceFragment]);
      } else {
        fragments.push(traceFragment);
      }
    }
  }
  return [...indexed]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([traceId, fragments]) => ({ traceId, fragments }));
}

export async function readCollectorSnapshot(
  input: ReadCollectorSessionInput,
): Promise<CollectorSnapshotReadResult> {
  validateIdentity(input);
  let lifecycle: CollectorLifecycleRecord;
  try {
    lifecycle = await readLifecycle(input);
  } catch (error) {
    return isMissing(error)
      ? {
          kind: 'collector-snapshot-missing',
          identity: identity(input),
          message: 'No retained collector session exists for the exact identity.',
        }
      : {
          kind: 'collector-snapshot-corrupt',
          identity: identity(input),
          error: recordedFailure(error),
        };
  }
  try {
    const retained = await readFragments(input);
    assertInventory({ lifecycle, fragments: retained });
    return {
      kind: 'collector-snapshot-found',
      identity: identity(input),
      lifecycle,
      fragments: retained.map(fragmentSummary),
      traces: traces(retained),
    };
  } catch (error) {
    return {
      kind: 'collector-snapshot-corrupt',
      identity: identity(input),
      error: recordedFailure(error),
    };
  }
}
