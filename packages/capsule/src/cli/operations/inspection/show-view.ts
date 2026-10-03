import type { CapsuleActivityReport, CapsuleObservationsResult } from '@suites/blackbox-capsule';

import { CliFailure } from '../../cli/failure.js';
import { nextSteps } from '../../cli/next-steps.js';
import { ActivityDisplay } from '../../context/display.js';
import { participantWarnings } from '../lifecycle/participant-warnings.js';
import type { CapsuleSummary, ProjectIndex } from '../../context/project-index.js';
import type { Resolved } from '../../context/resolver.js';
import { completenessOf, loadInvestigation, readSession } from './investigation-data.js';
import { CapsuleInvestigation } from './investigation-model.js';
import { activityView, capsuleView, timelineView, traceView } from './show-output.js';

export interface ShowRequest {
  readonly id: string;
  readonly capsuleFlag: string | null;
  readonly json: boolean;
  /** `show <trace> --spans`: the span table instead of the tree. */
  readonly spans: boolean;
  /** `show <capsule> --timeline`. */
  readonly timeline: boolean;
}

/** A trace ID retained nowhere, named with an explicit capsule that is still running. */
export interface PendingTrace {
  readonly kind: 'pending-trace';
  readonly capsule: CapsuleSummary;
  readonly traceId: string;
}

export interface ShowView {
  readonly lines: readonly string[];
  readonly next: readonly string[];
  /** Fields added to the phase 1 JSON document. */
  readonly document: Readonly<Record<string, unknown>>;
}

function latest(activities: readonly CapsuleActivityReport[]): CapsuleActivityReport | null {
  return activities.reduce<CapsuleActivityReport | null>(
    (found, activity) => (found === null || activity.sequence > found.sequence ? activity : found),
    null,
  );
}

function sessionTraceCount(result: CapsuleObservationsResult): number {
  return result.kind === 'collector-session-found' ? result.traceIds.length : 0;
}

async function investigate(input: {
  readonly projectDirectory: string;
  readonly capsule: CapsuleSummary;
  readonly activities: readonly CapsuleActivityReport[];
  readonly traceIds: readonly string[] | 'all';
}): Promise<CapsuleInvestigation> {
  const session = await readSession({
    projectDirectory: input.projectDirectory,
    capsule: input.capsule.capsule,
  });
  return new CapsuleInvestigation(await loadInvestigation({ ...input, session }));
}

async function capsuleShow(input: {
  readonly projectDirectory: string;
  readonly capsule: CapsuleSummary;
  readonly result: CapsuleObservationsResult;
  readonly activities: readonly CapsuleActivityReport[] | null;
  readonly display: ActivityDisplay;
  readonly timeline: boolean;
}): Promise<ShowView> {
  const last = input.activities === null ? null : latest(input.activities);
  const short = last === null ? null : input.display.short(last.activityId);
  if (!input.timeline) {
    return capsuleView({
      capsule: input.capsule,
      completeness: completenessOf(input.capsule, input.result),
      activities: input.activities,
      traceCount: sessionTraceCount(input.result),
      latest: short,
    });
  }
  if (input.activities === null) {
    // Without the activity record, every trace would look uncaused and the
    // timeline would claim there were no activities: refuse instead.
    throw new CliFailure({
      code: 'operation-failed',
      message: `capsule ${input.capsule.capsule}: its activity record could not be read, so there is no timeline`,
      details: [],
      candidates: [],
      next: [nextSteps.showCapsule(input.capsule.capsule)],
    });
  }
  const data = await loadInvestigation({
    projectDirectory: input.projectDirectory,
    capsule: input.capsule,
    activities: input.activities,
    session: input.result,
    traceIds: 'all',
  });
  return timelineView({
    investigation: new CapsuleInvestigation(data),
    short: (activityId) => input.display.short(activityId),
    latest: short,
  });
}

/**
 * A running capsule's exited participants, as warnings under the view's first
 * line and as `exitedParticipants` in JSON. Other states are not checked.
 */
async function withParticipantWarnings(view: ShowView, capsule: CapsuleSummary): Promise<ShowView> {
  if (capsule.state !== 'running') {
    return view;
  }
  const warnings = await participantWarnings(capsule.capsule);
  if (warnings.exited.length === 0) {
    return view;
  }
  return {
    ...view,
    lines: [
      ...view.lines.slice(0, 1),
      ...warnings.lines.map((line) => `  ${line}`),
      ...view.lines.slice(1),
    ],
    document: { ...view.document, exitedParticipants: warnings.exited },
  };
}

/** The human lines, suggestions and JSON additions for one resolved ID. */
export async function showView(input: {
  readonly projectDirectory: string;
  readonly index: ProjectIndex;
  readonly resolved: Resolved | PendingTrace;
  readonly result: CapsuleObservationsResult;
  readonly request: ShowRequest;
}): Promise<ShowView> {
  const { index, resolved, projectDirectory } = input;
  const display = new ActivityDisplay(
    (await index.allActivities()).map(({ activity }) => activity.activityId),
  );
  const activities = await index.activities(resolved.capsule.capsule);
  const capsule = resolved.capsule;
  switch (resolved.kind) {
    case 'activity':
      return withParticipantWarnings(
        activityView({
          short: display.short(resolved.activity.activityId),
          activity: resolved.activity,
          investigation: await investigate({
            projectDirectory,
            capsule,
            activities: activities ?? [resolved.activity],
            traceIds: 'all',
          }),
        }),
        capsule,
      );
    case 'capsule':
      return withParticipantWarnings(
        await capsuleShow({
          projectDirectory,
          capsule,
          result: input.result,
          activities,
          display,
          timeline: input.request.timeline,
        }),
        capsule,
      );
    case 'trace':
    case 'pending-trace': {
      if (activities === null) {
        throw new CliFailure({
          code: 'operation-failed',
          message: `capsule ${capsule.capsule}: its activity record could not be read, so there is no trace context`,
          details: [],
          candidates: [],
          next: [nextSteps.showCapsule(capsule.capsule)],
        });
      }
      const owner = activities.find(
        (activity) => activity.telemetry.context.traceId === resolved.traceId,
      );
      return traceView({
        traceId: resolved.traceId,
        investigation: await investigate({
          projectDirectory,
          capsule,
          activities,
          traceIds: [resolved.traceId],
        }),
        associated: owner === undefined ? null : display.short(owner.activityId),
        spans: input.request.spans,
      });
    }
  }
}
