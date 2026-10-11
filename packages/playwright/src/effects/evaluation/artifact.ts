import type { EffectAssessment, EffectGraph } from '@suites/blackbox-effects';

import type { ActivityProvenance, ActivitySelection } from '../../activities/types.js';
import type { EffectObservationReadResult } from './source.js';
import type { EffectEvidenceArtifact, EffectOwnershipExcerpt } from './artifact-types.js';
import { observationExcerpts } from './observation-artifact.js';

const limits = Object.freeze({
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
    activities: read.scope.activities.slice(0, limits.activities).map((activity) => ({
      ...activity,
      traceIds: activity.traceIds.slice(0, limits.tracesPerActivity),
    })),
  };
}

function ownership(read: AdmittedRead, graph: EffectGraph): readonly EffectOwnershipExcerpt[] {
  if (!owned(read)) {
    return [];
  }
  return graph.effects.map((effect) => ({
    effectId: effect.id,
    observations: effect.source.slice(0, limits.sourcesPerEffect).map((source) => ({
      ...source,
      owners: (read.provenance[`${source.traceId}:${source.spanId}`] ?? [])
        .slice(0, limits.ownersPerObservation)
        .map(({ activityId, purpose }) => ({ activityId, purpose })),
    })),
  }));
}

function assessment(value: EffectAssessment): EffectAssessment {
  return {
    ...value,
    findings: value.findings.slice(0, limits.findings).map((finding) => ({
      ...finding,
      evidence: finding.evidence.slice(0, limits.evidencePerFinding),
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
  const displayedTraces = total(activities.slice(0, limits.activities), (activity) =>
    Math.min(activity.traceIds.length, limits.tracesPerActivity),
  );
  const displayedSources = total(
    input.graph.effects.slice(0, limits.effects),
    (effect) => Math.min(effect.source.length, limits.sourcesPerEffect),
  );
  const displayedFindingEvidence = total(
    input.assessment.findings.slice(0, limits.findings),
    (finding) => Math.min(finding.evidence.length, limits.evidencePerFinding),
  );
  const displayedOwners = total(input.ownership.slice(0, limits.ownership), (effect) =>
    total(effect.observations, (observation) => observation.owners.length),
  );
  return {
    activities: Math.max(0, activities.length - limits.activities),
    activityTraces: Math.max(0, traceCount - displayedTraces),
    diagnostics: Math.max(0, input.read.diagnostics.length - limits.diagnostics),
    observations: Math.max(0, input.observations.total - input.observations.excerpts.length),
    effects: Math.max(0, input.graph.effects.length - limits.effects),
    effectSources: Math.max(0, sourceCount - displayedSources),
    relations: Math.max(0, input.graph.relations.length - limits.relations),
    qualityReasons: Math.max(0, input.graph.quality.reasons.length - limits.qualityReasons),
    findings: Math.max(0, input.assessment.findings.length - limits.findings),
    findingEvidence: Math.max(0, evidenceCount - displayedFindingEvidence),
    ownership: Math.max(0, input.ownership.length - limits.ownership),
    owners: Math.max(0, ownerCount - displayedOwners),
  };
}

export function createEffectEvidenceArtifact(input: {
  readonly read: AdmittedRead;
  readonly graph: EffectGraph;
  readonly assessment: EffectAssessment;
}): EffectEvidenceArtifact {
  const observations = observationExcerpts(input.read.payloads, limits.observations);
  const effectOwnership = ownership(input.read, input.graph);
  return {
    kind: 'admitted',
    observations: {
      scopeId: input.read.scopeId,
      payloadCount: input.read.payloads.length,
      diagnostics: input.read.diagnostics.slice(0, limits.diagnostics),
      excerpts: observations.excerpts,
    },
    selection: selection(input.read),
    projection: {
      schemaVersion: input.graph.schemaVersion,
      scope: input.graph.scope,
      quality: {
        ...input.graph.quality,
        reasons: input.graph.quality.reasons.slice(0, limits.qualityReasons),
      },
      effects: input.graph.effects.slice(0, limits.effects).map((effect) => ({
        id: effect.id,
        kind: effect.kind,
        operation: effect.operation,
        target: effect.target,
        actor: effect.actor,
        outcome: effect.outcome,
        source: effect.source.slice(0, limits.sourcesPerEffect),
      })),
      relations: input.graph.relations.slice(0, limits.relations),
    },
    assessment: assessment(input.assessment),
    ownership: effectOwnership.slice(0, limits.ownership),
    omitted: omitted({ ...input, observations, ownership: effectOwnership }),
  };
}
