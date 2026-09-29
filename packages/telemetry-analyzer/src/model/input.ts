/**
 * Plain data consumed by the pure normalizer. It deliberately does not reuse
 * collector or Capsule types: the caller assembles it from retained records,
 * and the analyzer never performs I/O.
 */
export interface EffectInput {
  readonly scope: EffectScopeInput;
  readonly sources: readonly EffectSource[];
}

export interface EffectScopeInput {
  readonly kind: 'capsule-session';
  readonly sessionId: string;
}

/**
 * Retained evidence sources. Later non-OpenTelemetry sources (authoritative
 * state reads, mock-server journals) extend this union without changing the
 * effect model.
 */
export type EffectSource = OtlpJsonFragmentsSource;

export interface OtlpJsonFragmentsSource {
  readonly kind: 'otlp-json-fragments';
  readonly fragments: readonly OtlpJsonFragment[];
}

/** One retained collector fragment: its sequence and exact OTLP/HTTP JSON text. */
export interface OtlpJsonFragment {
  readonly sequence: number;
  readonly rawJson: string;
}
