import type {
  CollectorLifecycleRecord,
  CollectorTracesReadResult,
  ReadCollectorSessionInput,
} from '../model/types.js';
import { recordedFailure, validateIdentity } from '../model/validation.js';
import { filterTraceRequest, traceIdsInRequest } from '../otlp/json.js';
import { assertInventory, identity, isMissing, readFragments, readLifecycle } from './reader.js';

export async function readCollectorTraces(
  input: ReadCollectorSessionInput,
): Promise<CollectorTracesReadResult> {
  validateIdentity(input);
  let lifecycle: CollectorLifecycleRecord;
  try {
    lifecycle = await readLifecycle(input);
  } catch (error) {
    return isMissing(error)
      ? {
          kind: 'collector-traces-missing',
          identity: identity(input),
          message: 'No retained collector session exists for the exact identity.',
        }
      : {
          kind: 'collector-traces-corrupt',
          identity: identity(input),
          error: recordedFailure(error),
        };
  }
  try {
    const retained = await readFragments(input);
    assertInventory({ lifecycle, fragments: retained });
    const requests = retained.map((fragment) => ({
      fragment,
      request: JSON.parse(fragment.rawJson) as unknown,
    }));
    const traceIds = [
      ...new Set(requests.flatMap(({ request }) => traceIdsInRequest(request))),
    ].sort();
    const traces = traceIds.map((traceId) => ({
      traceId,
      fragments: requests.flatMap(({ fragment, request }) => {
        const filtered = filterTraceRequest({ request, traceId });
        return filtered === null
          ? []
          : [{ sequence: fragment.sequence, receivedAt: fragment.receivedAt, request: filtered }];
      }),
    }));
    return { kind: 'collector-traces-found', identity: identity(input), traces };
  } catch (error) {
    return {
      kind: 'collector-traces-corrupt',
      identity: identity(input),
      error: recordedFailure(error),
    };
  }
}
