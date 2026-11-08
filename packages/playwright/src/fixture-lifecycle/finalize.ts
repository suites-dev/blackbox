import type { Digest } from '../envelope/index.js';

/** What an attempt produced that the receipt must be able to name, even when the attempt then fails. */
export interface AttemptProduct {
  envelope: Digest | null;
  cleanupFailed: boolean;
  executionFailed: boolean;
}

/**
 * Cleans up, then takes the final capture, in that order. The capture runs and its result is stored even when
 * cleanup throws, and the cleanup error still propagates. Returning the envelope from the function that also
 * rethrows would lose it exactly when cleanup fails, and the receipt would then claim there was no evidence.
 */
export async function finalizeAttempt(
  product: AttemptProduct,
  steps: {
    readonly cleanup: () => Promise<void>;
    readonly capture: () => Promise<Digest | null>;
  },
): Promise<void> {
  const cleanup = await Promise.allSettled([steps.cleanup()]);
  product.cleanupFailed = cleanup[0].status === 'rejected';
  const capture = await Promise.allSettled([steps.capture()]);
  if (capture[0].status === 'fulfilled') { product.envelope = capture[0].value; }
  const failures = [...cleanup, ...capture].flatMap((result) => result.status === 'rejected' ? [result.reason as unknown] : []);
  if (failures.length === 1) { throw failures[0]; }
  if (failures.length > 1) { throw new AggregateError(failures, 'Blackbox cleanup and capture failed'); }
}

export function newAttemptProduct(): AttemptProduct {
  return { envelope: null, cleanupFailed: false, executionFailed: false };
}
