import type { EffectCountOperator, EffectScalar, EffectSelector } from '../contract.js';

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

export type VerificationConstraint =
  | {
      readonly op: EffectCountOperator;
      readonly n: number;
      readonly selector: EffectSelector;
    }
  | { readonly op: 'before'; readonly a: EffectSelector; readonly b: EffectSelector };

export interface VerificationContract {
  readonly schemaVersion: '0.1.0';
  readonly constraints: readonly VerificationConstraint[];
}

export type VerificationStatus = 'pass' | 'fail' | 'inconclusive';

export interface VerificationFinding {
  readonly status: VerificationStatus;
  readonly reason: string;
  readonly evidence: readonly string[];
}

export interface VerificationAssessment {
  readonly status: VerificationStatus;
  readonly findings: readonly (VerificationFinding & { readonly index: number })[];
  readonly scope: string;
  readonly semanticsVersion: '0.1.0';
}

export interface EffectSelection {
  readonly definite: readonly ObservedEffect[];
  readonly possible: readonly ObservedEffect[];
}

export interface VerificationContext {
  readonly graph: EffectGraph;
  readonly closure: ReadonlyMap<string, ReadonlySet<string>>;
  readonly closed: boolean;
  readonly fullOrder: boolean;
}
