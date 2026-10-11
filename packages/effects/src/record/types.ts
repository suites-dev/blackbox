export const EFFECTS_RECORD_SCHEMA_VERSION = 0 as const;

/** The same kinds the Playwright effects contract selects on (`packages/playwright/src/effects/contract.ts`). */
export const EFFECT_KINDS = [
  'http',
  'rpc',
  'db',
  'cache',
  'message',
  'business',
  'internal',
] as const;

export type EffectKind = (typeof EFFECT_KINDS)[number];

export type EffectsRecordSource =
  | { readonly kind: 'playwright-attempt'; readonly id: string }
  | { readonly kind: 'capsule-activity'; readonly id: string };

/**
 * Whether the retained observations can be treated as final. The record states this
 * once; a missing effect only means "not observed" when it is `complete`.
 */
export type EffectsCompleteness =
  | { readonly status: 'provisional' | 'complete' }
  | { readonly status: 'incomplete'; readonly reason: string };

/** One normalized operation, counted over the record's scope. */
export interface Effect {
  readonly kind: EffectKind;
  readonly operation: string;
  readonly target: string;
  readonly outcome: string;
  readonly count: number;
}

export interface EffectsRecord {
  readonly schemaVersion: typeof EFFECTS_RECORD_SCHEMA_VERSION;
  readonly source: EffectsRecordSource;
  readonly completeness: EffectsCompleteness;
  readonly effects: readonly Effect[];
}

export interface EffectsRecordInput {
  readonly source: EffectsRecordSource;
  readonly completeness: EffectsCompleteness;
  readonly effects: readonly Effect[];
}
