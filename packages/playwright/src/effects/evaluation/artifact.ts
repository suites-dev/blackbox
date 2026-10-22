import type { EffectAssessment, EffectGraph } from '@suites/blackbox-effects';

import type { ActivityProvenance, ActivitySelection } from '../../activities/types.js';
import type { EffectObservationReadResult } from './source.js';
import type {
  EffectEvidenceArtifact,
  EffectOwnershipExcerpt,
  EffectSnapshotArtifact,
} from './artifact-types.js';
import { observationExcerpts } from './observation-artifact.js';

export const evidenceLimits = Object.freeze({
  diagnostics: 32,
  observations: 128,
  effects: 128,
  relations: 256,
  findings: 64,
  ownership: 128,
  ownersPerObservation: 8,
  activities: 16,
  tracesPerActivity: 8,
  sourcesPerEffect: 16,
  qualityReasons: 32,
  evidencePerFinding: 16,
});

type AdmittedRead = Extract<EffectObservationReadResult, { readonly kind: 'admitted' }>;
type OwnedRead = AdmittedRead & {
  readonly scope: ActivitySelection;
  readonly provenance: Readonly<Record<string, readonly ActivityProvenance[]>>;
};

function owned(read: AdmittedRead): read is OwnedRead {
  return 'scope' in read && 'provenance' in read;
}

function selection(read: AdmittedRead): EffectEvidenceArtifact['selection'] {
  if (!owned(read)) {
    return { kind: 'not-reported' };
  }
  return {
    ...read.scope,
    activities: read.scope.activities.slice(0, evidenceLimits.activities).map((activity) => ({
      ...activity,
      traceIds: activity.traceIds.slice(0, evidenceLimits.tracesPerActivity),
    })),
  };
}

function ownership(read: AdmittedRead, graph: EffectGraph): readonly EffectOwnershipExcerpt[] {
  if (!owned(read)) {
    return [];
  }
  return graph.effects.map((effect) => ({
    effectId: effect.id,
    observations: effect.source.slice(0, evidenceLimits.sourcesPerEffect).map((source) => ({
      ...source,
      owners: (read.provenance[`${source.traceId}:${source.spanId}`] ?? [])
        .slice(0, evidenceLimits.ownersPerObservation)
        .map(({ activityId, purpose }) => ({ activityId, purpose })),
    })),
  }));
}

function assessment(value: EffectAssessment): EffectAssessment {
  return {
    ...value,
    findings: value.findings.slice(0, evidenceLimits.findings).map((finding) => ({
      ...finding,
      evidence: finding.evidence.slice(0, evidenceLimits.evidencePerFinding),
    })),
  };
}

function total<Activity>(values: readonly Activity[], count: (value: Activity) => number): number {
  return values.reduce((sum, value) => sum + count(value), 0);
}

function omitted(input: {
  readonly read: AdmittedRead;
  readonly graph: EffectGraph;
  readonly assessment: EffectAssessment;
  readonly observations: ReturnType<typeof observationExcerpts>;
  readonly ownership: readonly EffectOwnershipExcerpt[];
}): EffectEvidenceArtifact['omitted'] {
  const sourceCount = total(input.graph.effects, (effect) => effect.source.length);
  const evidenceCount = total(input.assessment.findings, (finding) => finding.evidence.length);
  const activities = owned(input.read) ? input.read.scope.activities : [];
  const traceCount = total(activities, (activity) => activity.traceIds.length);
  const ownerCount = owned(input.read)
    ? total(Object.values(input.read.provenance), (owners) => owners.length)
    : 0;
  const displayedTraces = total(activities.slice(0, evidenceLimits.activities), (activity) =>
    Math.min(activity.traceIds.length, evidenceLimits.tracesPerActivity),
  );
  const displayedSources = total(input.graph.effects.slice(0, evidenceLimits.effects), (effect) =>
    Math.min(effect.source.length, evidenceLimits.sourcesPerEffect),
  );
  const displayedFindingEvidence = total(
    input.assessment.findings.slice(0, evidenceLimits.findings),
    (finding) => Math.min(finding.evidence.length, evidenceLimits.evidencePerFinding),
  );
  const displayedOwners = total(input.ownership.slice(0, evidenceLimits.ownership), (effect) =>
    total(effect.observations, (observation) => observation.owners.length),
  );
  return {
    activities: Math.max(0, activities.length - evidenceLimits.activities),
    activityTraces: Math.max(0, traceCount - displayedTraces),
    diagnostics: Math.max(0, input.read.diagnostics.length - evidenceLimits.diagnostics),
    observations: Math.max(0, input.observations.total - input.observations.excerpts.length),
    effects: Math.max(0, input.graph.effects.length - evidenceLimits.effects),
    effectSources: Math.max(0, sourceCount - displayedSources),
    relations: Math.max(0, input.graph.relations.length - evidenceLimits.relations),
    qualityReasons: Math.max(0, input.graph.quality.reasons.length - evidenceLimits.qualityReasons),
    findings: Math.max(0, input.assessment.findings.length - evidenceLimits.findings),
    findingEvidence: Math.max(0, evidenceCount - displayedFindingEvidence),
    ownership: Math.max(0, input.ownership.length - evidenceLimits.ownership),
    owners: Math.max(0, ownerCount - displayedOwners),
  };
}

export function createEffectEvidenceArtifact(input: {
  readonly read: AdmittedRead;
  readonly graph: EffectGraph;
  readonly assessment: EffectAssessment;
}): EffectEvidenceArtifact {
  const observations = observationExcerpts(input.read.payloads, evidenceLimits.observations);
  const effectOwnership = ownership(input.read, input.graph);
  return {
    kind: 'admitted',
    observations: {
      scopeId: input.read.scopeId,
      payloadCount: input.read.payloads.length,
      diagnostics: input.read.diagnostics.slice(0, evidenceLimits.diagnostics),
      excerpts: observations.excerpts,
    },
    selection: selection(input.read),
    projection: {
      schemaVersion: input.graph.schemaVersion,
      scope: input.graph.scope,
      quality: {
        ...input.graph.quality,
        reasons: input.graph.quality.reasons.slice(0, evidenceLimits.qualityReasons),
      },
      effects: input.graph.effects.slice(0, evidenceLimits.effects).map((effect) => ({
        id: effect.id,
        kind: effect.kind,
        operation: effect.operation,
        target: effect.target,
        actor: effect.actor,
        outcome: effect.outcome,
        source: effect.source.slice(0, evidenceLimits.sourcesPerEffect),
      })),
      relations: input.graph.relations.slice(0, evidenceLimits.relations),
    },
    assessment: assessment(input.assessment),
    ownership: effectOwnership.slice(0, evidenceLimits.ownership),
    omitted: omitted({ ...input, observations, ownership: effectOwnership }),
  };
}

/**
 * The same excerpts, projection and ownership as an assertion's evidence, for a read that no contract
 * judged. It is built from the evidence artifact with an empty assessment, then the assessment is dropped.
 */
export function createEffectSnapshotArtifact(input: {
  readonly read: AdmittedRead;
  readonly graph: EffectGraph;
}): EffectSnapshotArtifact {
  const {
    assessment: _assessment,
    omitted,
    ...evidence
  } = createEffectEvidenceArtifact({
    ...input,
    assessment: {
      status: 'inconclusive',
      findings: [],
      scope: input.read.scopeId,
      semanticsVersion: '0.1.0',
    },
  });
  const { findings: _findings, findingEvidence: _findingEvidence, ...retained } = omitted;
  return { ...evidence, omitted: retained };
}
