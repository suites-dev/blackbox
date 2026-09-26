import type {
  CollectorActivityReadResult,
  ReadCollectorActivityInput,
  TraceFragment,
} from '../model/types.js';
import { recordedFailure, validateIdentity, validateNonBlankField } from '../model/validation.js';
import { filterActivityRequest, traceIdsInRequest } from '../otlp/json.js';
import {
  assertInventory,
  identity,
  isMissing,
  readFragments,
  readLifecycle,
} from './reader.js';

export async function readCollectorActivity(
  input: ReadCollectorActivityInput,
): Promise<CollectorActivityReadResult> {
  validateIdentity(input);
  const activityId = validateNonBlankField({ field: 'activityId', value: input.activityId });
  try {
    const lifecycle = await readLifecycle(input);
    const retained = await readFragments(input);
    assertInventory({ lifecycle, fragments: retained });
    const fragments: TraceFragment[] = [];
    const traceIds = new Set<string>();
    for (const fragment of retained) {
      const request = JSON.parse(fragment.rawJson) as unknown;
      const filtered = filterActivityRequest({ request, activityId });
      if (filtered !== null) {
        fragments.push({
          sequence: fragment.sequence,
          receivedAt: fragment.receivedAt,
          request: filtered,
        });
        for (const traceId of traceIdsInRequest(filtered)) {
          traceIds.add(traceId);
        }
      }
    }
    return fragments.length === 0
      ? {
          kind: 'collector-activity-missing',
          identity: identity(input),
          activityId,
          message: 'No retained spans exist for the exact activity ID.',
        }
      : {
          kind: 'collector-activity-found',
          identity: identity(input),
          activityId,
          fragments,
          traceIds: [...traceIds].sort(),
        };
  } catch (error) {
    if (isMissing(error)) {
      return {
        kind: 'collector-activity-missing',
        identity: identity(input),
        activityId,
        message: 'No retained collector session exists for the exact identity.',
      };
    }
    return {
      kind: 'collector-activity-corrupt',
      identity: identity(input),
      activityId,
      error: recordedFailure(error),
    };
  }
}
