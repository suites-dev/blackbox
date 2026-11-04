/**
 * What the rest of the package may use from the envelope module without depending on each of its files: the
 * canonical serialization and digest functions, and the envelope types. Everything else is imported directly.
 */
export { canonicalization, canonicalize, digestBytes, digestOf, type Digest } from './canonical.js';
export type * from './types.js';
