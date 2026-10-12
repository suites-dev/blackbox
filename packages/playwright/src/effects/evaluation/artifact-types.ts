import type { EffectAssessment, EffectScalar } from '@suites/blackbox-effects';

import type { ActivityPurpose, ActivitySelection } from '../../activities/types.js';

export interface ObservationExcerpt {
  readonly traceId: string;
  readonly spanId: string;
  readonly service: string;
  readonly kind: string;
  readonly status: string;
  readonly fields: readonly {
    readonly key: string;
    readonly value: EffectScalar;
  }[];
}

export interface ProjectedEffectExcerpt {
  readonly id: string;
  readonly kind: string;
  readonly operation: string;
  readonly target: string;
  readonly actor: string;
  readonly outcome: string;
  readonly source: readonly { readonly traceId: string; readonly spanId: string }[];
}

export interface EffectOwnershipExcerpt {
  readonly effectId: string;
  readonly observations: readonly {
    readonly traceId: string;
    readonly spanId: string;
    readonly owners: readonly {
      readonly activityId: string;
      readonly purpose: ActivityPurpose;
    }[];
  }[];
}

export interface EffectEvidenceArtifact {
  readonly kind: 'admitted';
  readonly observations: {
    readonly scopeId: string;
    readonly payloadCount: number;
    readonly diagnostics: readonly string[];
    readonly excerpts: readonly ObservationExcerpt[];
  };
  readonly selection:
    | { readonly kind: 'not-reported' }
    | Pick<ActivitySelection, 'scopeId' | 'sessionId' | 'executionId' | 'kind' | 'activities'>;
  readonly projection: {
    readonly schemaVersion: '0.1.1';
    readonly scope: { readonly id: string; readonly closed: boolean };
    readonly quality: {
      readonly coverage: 'unknown' | 'partial' | 'complete';
      readonly orderCoverage: 'unknown' | 'partial' | 'complete';
      readonly reasons: readonly string[];
      readonly attestation: string;
    };
    readonly effects: readonly ProjectedEffectExcerpt[];
    readonly relations: readonly {
      readonly type: 'happensBefore' | 'parent' | 'link';
      readonly from: string;
      readonly to: string;
      readonly evidence: string;
    }[];
  };
  readonly assessment: EffectAssessment;
  readonly ownership: readonly EffectOwnershipExcerpt[];
  readonly omitted: {
    readonly activities: number;
    readonly activityTraces: number;
    readonly diagnostics: number;
    readonly observations: number;
    readonly effects: number;
    readonly effectSources: number;
    readonly relations: number;
    readonly qualityReasons: number;
    readonly findings: number;
    readonly findingEvidence: number;
    readonly ownership: number;
    readonly owners: number;
  };
}
