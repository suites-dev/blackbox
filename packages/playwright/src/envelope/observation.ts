import { createEffectsRecord, EFFECT_KINDS, type EffectsRecord } from '@suites/blackbox-effects';

import type { FinalSnapshotDocument } from '../effects/final-snapshot.js';
import { detailedEffects } from './effects.js';
import type { CoverageParticipant, ObservedSection, ParticipantExpectation } from './types.js';

function recordKind(kind: string): (typeof EFFECT_KINDS)[number] {
  return EFFECT_KINDS.find((known) => known === kind) ?? 'unknown';
}

/** The unchanged v0 record, or nothing: a record with no effects would read as "none happened". */
export function effectsRecordOf(
  snapshot: FinalSnapshotDocument,
  attemptId: string,
): { readonly record: EffectsRecord | null; readonly reason: string | null } {
  if (snapshot.evidence.kind !== 'admitted') {
    return { record: null, reason: `observation-${snapshot.observation.state}` };
  }
  const omitted = snapshot.evidence.omitted.effects > 0 ? ['evidence-omitted'] : [];
  const reasons = [...snapshot.completeness.reasons, ...omitted];
  return {
    record: createEffectsRecord({
      source: { kind: 'playwright-attempt', id: attemptId },
      completeness: {
        status: 'incomplete',
        reason: reasons.length > 0 ? reasons.join('; ') : 'not-demonstrated',
      },
      effects: snapshot.evidence.projection.effects.map((effect) => ({
        kind: recordKind(effect.kind),
        operation: effect.operation,
        target: effect.target,
        outcome: effect.outcome,
        count: 1,
      })),
    }),
    reason: null,
  };
}

function participantStatus(
  participant: ParticipantExpectation,
  snapshot: FinalSnapshotDocument,
): CoverageParticipant['status'] {
  if (participant.instrumentation === 'unconfigured') {
    return 'unconfigured';
  }
  const { collector } = snapshot.finalization;
  if (collector.state !== 'found') {
    return 'unknown';
  }
  if (snapshot.observation.observedServices.includes(participant.service)) {
    return 'observed';
  }
  return collector.activatedServices.includes(participant.service)
    ? 'activated-without-observation'
    : 'configured-not-activated';
}

export function observedSection(input: {
  readonly snapshot: FinalSnapshotDocument | null;
  readonly snapshotEvidence: ObservedSection['finalSnapshot'];
  readonly participants: readonly ParticipantExpectation[];
  readonly attemptId: string;
}): ObservedSection {
  const { snapshot } = input;
  if (snapshot === null) {
    return {
      finalSnapshot: input.snapshotEvidence,
      observation: { state: 'no-final-snapshot', payloadCount: 0 },
      completeness: { status: 'unavailable', closed: false, reasons: ['no-final-snapshot'] },
      coverage: {
        participants: input.participants.map(({ id, service }) => ({
          id,
          service,
          status: 'unknown',
        })),
        gaps: input.participants
          .filter(({ instrumentation }) => instrumentation === 'configured')
          .map(({ id }) => `unknown:${id}`),
      },
      effectsRecord: null,
      effectsRecordReason: 'no-final-snapshot',
    };
  }
  const participants = input.participants.map(({ id, service, ...rest }) => ({
    id,
    service,
    status: participantStatus({ id, service, ...rest }, snapshot),
  }));
  const { record, reason } = effectsRecordOf(snapshot, input.attemptId);
  return {
    finalSnapshot: input.snapshotEvidence,
    observation: {
      state: snapshot.observation.state,
      payloadCount: snapshot.observation.payloadCount,
    },
    completeness: {
      status: snapshot.completeness.status,
      closed: snapshot.completeness.closed,
      reasons: snapshot.completeness.reasons,
    },
    coverage: {
      participants,
      gaps: participants
        .filter(({ status }) => status !== 'observed' && status !== 'unconfigured')
        .map(({ id, status }) => `${status}:${id}`),
    },
    effectsRecord: record,
    effectsRecordReason: reason,
  };
}

export { detailedEffects };
