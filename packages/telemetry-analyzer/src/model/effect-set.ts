/**
 * EffectSet v1 as produced by this normalizer version. The JSON Schema in
 * `src/schema/effect-set-v1.json` is the published contract for these types.
 */
export interface EffectSet {
  readonly schemaVersion: 1;
  readonly kind: 'effect-set';
  readonly normalizer: NormalizerIdentity;
  readonly conventions: ConventionsIdentity;
  readonly policy: PolicyHeader;
  readonly scope: EffectScope;
  readonly completeness: Completeness;
  readonly inputs: readonly InputDigest[];
  readonly limitations: readonly CaptureLimitation[];
  readonly exclusions: readonly Exclusion[];
  readonly effects: readonly Effect[];
  readonly captureStatus: readonly CaptureStatus[];
}

export interface NormalizerIdentity {
  readonly version: string;
  /** `sha256:<hex>` over the canonical ruleset data. */
  readonly rulesetDigest: string;
}

/** Which attribute alias table interpreted the spans. None exists yet. */
export interface ConventionsIdentity {
  readonly kind: 'no-alias-table';
}

export interface PolicyHeader {
  readonly kind: 'unavailable';
}

export interface EffectScope {
  readonly kind: 'capsule-session';
  readonly sessionId: string;
  readonly activities: readonly ScopeActivity[];
}

export interface ScopeActivity {
  readonly activityId: string;
  readonly purpose: string;
  readonly traceId: string;
}

export type Completeness =
  | { readonly kind: 'complete' }
  | { readonly kind: 'provisional'; readonly reasons: readonly string[] };

export interface InputDigest {
  readonly kind: 'otlp-json-fragment';
  readonly sequence: number;
  /** `sha256:<hex>` of the fragment's raw JSON text encoded as UTF-8. */
  readonly sha256: string;
}

/** The same occurrence was delivered more than once with different content. */
export interface ConflictingDuplicateDelivery {
  readonly kind: 'conflicting-duplicate-delivery';
  readonly service: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly deliveries: readonly number[];
  /** The delivery whose content the occurrence was built from. */
  readonly retained: number;
}

export type CaptureLimitation = ConflictingDuplicateDelivery;

export interface Exclusion {
  readonly ruleId: string;
  readonly occurrences: readonly OccurrenceRef[];
}

export interface OccurrenceMatch {
  readonly classification: string;
  readonly aliases: readonly { readonly attribute: string; readonly matched: string }[];
  readonly scrubbers: readonly string[];
}

export interface OccurrenceRef {
  readonly service: string;
  readonly traceId: string;
  readonly spanId: string;
  /** Fragment sequences that delivered this occurrence, ascending. */
  readonly deliveries: readonly number[];
  readonly matched: OccurrenceMatch;
}

export type SpanKindName =
  'unspecified' | 'internal' | 'server' | 'client' | 'producer' | 'consumer';

export interface UnclassifiedIdentity {
  readonly service: string;
  readonly spanKind: SpanKindName;
  readonly name: string;
  readonly scope: string;
}

export type EffectKind = 'unclassified';

export interface Linkage {
  readonly kind: 'unlinked';
}

export interface Suppression {
  readonly kind: 'none';
}

export interface Effect {
  /** `e_` + the first 16 hex characters of SHA-256 over the canonical identity key. */
  readonly id: string;
  readonly kind: EffectKind;
  readonly identity: UnclassifiedIdentity;
  readonly linkage: Linkage;
  readonly suppression: Suppression;
  readonly count: number;
  readonly occurrences: readonly OccurrenceRef[];
}

/** Capture status per service and boundary. Not evaluated by this normalizer version. */
export interface CaptureStatus {
  readonly service: string;
  readonly boundary: 'http.server' | 'http.client' | 'db' | 'cache' | 'messaging';
  readonly status: 'observed' | 'not-observed-with-activation-evidence' | 'unknown';
}
