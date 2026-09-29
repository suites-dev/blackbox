import type { CollectorFragmentsReadResult } from '../../model/fragment-types.js';
import type { CollectorLifecycleRecord, ReadCollectorSessionInput } from '../../model/types.js';
import { recordedFailure, validateIdentity } from '../../model/validation.js';
import { assertInventory, identity, isMissing, readFragments, readLifecycle } from '../reader.js';

/**
 * Read every retained fragment for one exact collector identity with its raw
 * OTLP JSON text unchanged, in sequence order. The inventory is checked
 * against the lifecycle exactly like the other readers, so a partial fragment
 * set is reported as corrupt rather than returned as found.
 */
export async function readCollectorFragments(
  input: ReadCollectorSessionInput,
): Promise<CollectorFragmentsReadResult> {
  validateIdentity(input);
  let lifecycle: CollectorLifecycleRecord;
  try {
    lifecycle = await readLifecycle(input);
  } catch (error) {
    return isMissing(error)
      ? {
          kind: 'collector-fragments-missing',
          identity: identity(input),
          message: 'No retained collector session exists for the exact identity.',
        }
      : {
          kind: 'collector-fragments-corrupt',
          identity: identity(input),
          error: recordedFailure(error),
        };
  }
  try {
    const retained = await readFragments(input);
    assertInventory({ lifecycle, fragments: retained });
    return {
      kind: 'collector-fragments-found',
      identity: identity(input),
      lifecycle,
      fragments: retained.map((fragment) => ({
        sequence: fragment.sequence,
        receivedAt: fragment.receivedAt,
        rawJson: fragment.rawJson,
      })),
    };
  } catch (error) {
    return {
      kind: 'collector-fragments-corrupt',
      identity: identity(input),
      error: recordedFailure(error),
    };
  }
}
