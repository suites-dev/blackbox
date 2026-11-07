import type { EffectCountOperator, EffectSelector } from '../contract.js';
import type { EffectGraph } from '../graph/model.js';

export type {
  EffectGraph,
  ObservedEffect,
  EffectRelation,
  EffectSelection,
} from '../graph/model.js';

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

export interface VerificationContext {
  readonly graph: EffectGraph;
  readonly closure: ReadonlyMap<string, ReadonlySet<string>>;
  readonly closed: boolean;
  readonly fullOrder: boolean;
}
