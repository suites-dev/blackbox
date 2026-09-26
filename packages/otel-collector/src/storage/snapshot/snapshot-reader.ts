import type {
  CollectorLifecycleRecord,
  CollectorSnapshotReadResult,
  ReadCollectorSessionInput,
  RetainedFragment,
  RetainedFragmentSummary,
  TraceFragment,
} from '../../model/types.js';
import { recordedFailure, validateIdentity } from '../../model/validation.js';
import { filterTraceRequest, traceIdsInRequest } from '../../otlp/json.js';
import { assertInventory, identity, isMissing, readFragments, readLifecycle } from '../reader.js';

function fragmentSummary(fragment: RetainedFragment): RetainedFragmentSummary {
  return {
    sequence: fragment.sequence,
    receivedAt: fragment.receivedAt,
    spanCount: fragment.spanCount,
  };
}

function traces(retained: readonly RetainedFragment[]) {
  const requests = retained.map((fragment) => ({
    fragment,
    request: JSON.parse(fragment.rawJson) as unknown,
  }));
  const traceIds = [
    ...new Set(requests.flatMap(({ request }) => traceIdsInRequest(request))),
  ].sort();
  return traceIds.map((traceId) => ({
    traceId,
    fragments: requests.flatMap(({ fragment, request }): TraceFragment[] => {
      const filtered = filterTraceRequest({ request, traceId });
      return filtered === null
        ? []
        : [{ sequence: fragment.sequence, receivedAt: fragment.receivedAt, request: filtered }];
    }),
  }));
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
