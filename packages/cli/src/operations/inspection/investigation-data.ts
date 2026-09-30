import {
  observationCompleteness,
  projectInvestigationSpans,
  readCapsuleObservations,
  type CapsuleActivityReport,
  type CapsuleObservationsResult,
  type CapsuleReportSpan,
  type ObservationCompleteness,
} from '@suites/blackbox-capsule';

import type { CapsuleSummary } from '../../context/project-index.js';

export interface RetainedTrace {
  readonly traceId: string;
  readonly spans: readonly CapsuleReportSpan[];
}

/** Everything show derives trees, causality and completeness from. */
export interface InvestigationData {
  readonly capsule: CapsuleSummary;
  readonly completeness: ObservationCompleteness;
  readonly activities: readonly CapsuleActivityReport[];
  readonly traces: readonly RetainedTrace[];
}

type SessionResult = Extract<CapsuleObservationsResult, { kind: `collector-session-${string}` }>;

function isSessionResult(result: CapsuleObservationsResult): result is SessionResult {
  return result.kind.startsWith('collector-session-');
}

/** The capsule's status from its state and the collector lifecycle record. */
export function completenessOf(
  capsule: CapsuleSummary,
  session: CapsuleObservationsResult | null,
): ObservationCompleteness {
  const lifecycle =
    session !== null && session.kind === 'collector-session-found' ? session.lifecycle : null;
  return observationCompleteness({ state: capsule.state, lifecycle });
}

/** The capsule's session observation read (lifecycle and trace IDs), or null when unreadable. */
export async function readSession(input: {
  readonly projectDirectory: string;
  readonly capsule: string;
}): Promise<SessionResult | null> {
  const result = await readCapsuleObservations({
    projectDirectory: input.projectDirectory,
    sessionId: input.capsule,
    selection: { kind: 'session' },
  });
  return isSessionResult(result) ? result : null;
}

async function readTrace(input: {
  readonly projectDirectory: string;
  readonly capsule: string;
  readonly traceId: string;
}): Promise<RetainedTrace> {
  const result = await readCapsuleObservations({
    projectDirectory: input.projectDirectory,
    sessionId: input.capsule,
    selection: { kind: 'trace', traceId: input.traceId },
  });
  return {
    traceId: input.traceId,
    spans:
      result.kind === 'collector-trace-found'
        ? projectInvestigationSpans({ fragments: result.fragments, traceId: input.traceId })
        : [],
  };
}

/**
 * Reads the capsule's retained traces through the existing observation reads:
 * the given trace IDs, or with 'all' every trace the collector retained plus
 * each activity's own trace.
 */
export async function loadInvestigation(input: {
  readonly projectDirectory: string;
  readonly capsule: CapsuleSummary;
  readonly activities: readonly CapsuleActivityReport[];
  /** The capsule's session read; any other result counts as no collector record. */
  readonly session: CapsuleObservationsResult | null;
  readonly traceIds: readonly string[] | 'all';
}): Promise<InvestigationData> {
  const collected =
    input.session !== null && input.session.kind === 'collector-session-found'
      ? input.session.traceIds
      : [];
  const own = input.activities.map((activity) => activity.telemetry.context.traceId);
  const traceIds = input.traceIds === 'all' ? [...new Set([...collected, ...own])] : input.traceIds;
  // One read at a time: each opens the capsule's fragment files.
  const traces: RetainedTrace[] = [];
  for (const traceId of traceIds) {
    traces.push(
      await readTrace({
        projectDirectory: input.projectDirectory,
        capsule: input.capsule.capsule,
        traceId,
      }),
    );
  }
  return {
    capsule: input.capsule,
    completeness: completenessOf(input.capsule, input.session),
    activities: input.activities,
    traces,
  };
}
