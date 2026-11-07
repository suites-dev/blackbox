import type { SerializedCheckpoint, SerializedComparison } from './types.js';

// Allow two 1 MB cuts, row-change wrappers and metadata for up to 10,000 readers.
// The execution artifact writer independently bounds its combined document.
export const stateEnvelopeByteLimit = 8_000_000;

/** Captured values already enforce raw depth/node limits; wrappers add fixed nesting. */
export function validateStateEnvelope(value: SerializedCheckpoint | SerializedComparison): void {
  if (Buffer.byteLength(JSON.stringify(value)) > stateEnvelopeByteLimit) {
    throw new Error('Serialized state evidence exceeds limits');
  }
}
