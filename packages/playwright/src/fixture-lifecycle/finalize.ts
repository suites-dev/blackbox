import type { Digest } from '../envelope/index.js';

/** What an attempt produced that the receipt must be able to name, even when the attempt then fails. */
export interface AttemptProduct {
  envelope: Digest | null;
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
  try {
    await steps.cleanup();
  } finally {
    product.envelope = await steps.capture();
  }
}

export function newAttemptProduct(): AttemptProduct {
  return { envelope: null };
}
