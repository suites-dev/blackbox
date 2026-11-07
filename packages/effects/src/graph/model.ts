import type { EffectScalar } from '../contracts/model.js';

export interface ObservedEffect {
  readonly id: string;
  readonly kind: string;
  readonly operation: string;
  readonly target: string;
  readonly actor: string;
  readonly outcome: string;
  readonly attributes: Readonly<Partial<Record<string, EffectScalar>>>;
  readonly source: readonly { readonly traceId: string; readonly spanId: string }[];
}

export interface EffectRelation {
  readonly type: 'happensBefore' | 'parent' | 'link';
  readonly from: string;
  readonly to: string;
  readonly evidence: string;
}

export interface EffectGraph {
  readonly schemaVersion: '0.1.1';
  readonly scope: { readonly id: string; readonly closed: boolean };
  readonly quality: {
    readonly coverage: 'unknown' | 'partial' | 'complete';
    readonly orderCoverage: 'unknown' | 'partial' | 'complete';
    readonly reasons: readonly string[];
    readonly attestation: string;
  };
  readonly effects: readonly ObservedEffect[];
  readonly relations: readonly EffectRelation[];
}

export interface EffectSelection {
  readonly definite: readonly ObservedEffect[];
  readonly possible: readonly ObservedEffect[];
}
