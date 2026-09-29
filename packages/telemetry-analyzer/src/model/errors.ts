/**
 * The input cannot be normalized: a fragment is not valid OTLP/HTTP JSON, or
 * the input breaks a structural invariant such as unique fragment sequences.
 * Retained evidence is never repaired or partially read.
 */
export class InvalidEffectInputError extends Error {
  override readonly name = 'InvalidEffectInputError';
}
