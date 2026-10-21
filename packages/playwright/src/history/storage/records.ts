import { digestOf } from '../../envelope/canonical.js';
import type { BehavioralDelta } from '../../compare/types.js';

/** A stored comparison is content-addressed like everything else: its digest covers every other field. */
export function verifyDelta(value: unknown): {
  readonly ok: boolean;
  readonly problems: readonly string[];
} {
  if (
    value === null ||
    typeof value !== 'object' ||
    !('kind' in value) ||
    value.kind !== 'behavioral-delta'
  ) {
    return { ok: false, problems: ['not a behavioral delta'] };
  }
  try {
    const { digest, ...rest } = value as BehavioralDelta;
    return digest === digestOf(rest)
      ? { ok: true, problems: [] }
      : { ok: false, problems: ['digest'] };
  } catch (error) {
    return {
      ok: false,
      problems: [`malformed: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}
