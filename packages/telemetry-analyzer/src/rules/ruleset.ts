import { canonicalDigest } from '../canonical/digest.js';

/**
 * Classification, exclusion, and suppression rules are data. This version has
 * no classification rules yet: every retained span falls through to the
 * `unclassified` fallback, and nothing is excluded or suppressed.
 */
export interface Ruleset {
  readonly version: number;
  readonly fallback: { readonly id: string; readonly kind: 'unclassified' };
}

export const EFFECT_NORMALIZER_VERSION = '0.1.0';

export const builtInRuleset = Object.freeze({
  version: 1,
  fallback: Object.freeze({ id: 'fallback.unclassified', kind: 'unclassified' }),
}) satisfies Ruleset;

/** `sha256:<hex>` over the ruleset's canonical JSON. */
export function rulesetDigest(ruleset: Ruleset): string {
  return canonicalDigest(ruleset);
}
