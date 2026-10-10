import { projectActivityTelemetry } from './telemetry.js';
import { projectCausality } from './causality/project.js';
import { projectObservations } from './observations.js';
import type { CapsuleProgressEvent } from '../progress/events.js';
import type { CapsuleSessionState } from '../model/session-state.js';
import { evidenceUpdatedAt, projectObservationPolicy } from './policy.js';
import { infrastructureContainers } from './resources.js';
import { createRedactionContext, redactActivities, redactError, redactText } from './redaction.js';
import type { CapsuleReportCausality } from './causality/types.js';
import type {
  CapsuleReportBody,
  CapsuleReportDocument,
  CapsuleReportLifecycle,
  CapsuleReportProjectionInput,
} from './types.js';

function lifecycle(state: CapsuleSessionState): CapsuleReportLifecycle {
  switch (state) {
    case 'running':
      return { kind: 'running', retainedState: state };
    case 'stopped':
      return { kind: 'stopped', retainedState: state };
    case 'start-failed':
    case 'manager-failed':
    case 'stop-failed':
      return { kind: 'failed', retainedState: state };
    case 'admitted':
    case 'manager-starting':
    case 'sandbox-starting':
      return { kind: 'starting', retainedState: state };
    case 'stopping':
      return { kind: 'stopping', retainedState: state };
  }
}

function redactProgress(input: {
  readonly events: readonly CapsuleProgressEvent[];
  readonly context: ReturnType<typeof createRedactionContext>;
}): readonly CapsuleProgressEvent[] {
  return input.events.map((event) => {
    switch (event.kind) {
      case 'endpoint-mapped':
        return {
          ...event,
          endpoint: {
            ...event.endpoint,
            url: redactText(event.endpoint.url, 'progress.endpoint.url', input.context),
          },
        };
      case 'readiness-started':
      case 'readiness-succeeded':
        return {
          ...event,
          url: redactText(event.url, 'progress.readiness.url', input.context),
        };
      case 'capsule-start-failed':
        return {
          ...event,
          cause: redactError({
            error: event.cause,
            location: 'progress.cause',
            context: input.context,
          }),
        };
      case 'capsule-stop-failed':
        return {
          ...event,
          error: redactError({
            error: event.error,
            location: 'progress.error',
            context: input.context,
          }),
        };
      default:
        return event;
    }
  });
}

function cleanupProjection(
  input: CapsuleReportProjectionInput,
  context: ReturnType<typeof createRedactionContext>,
) {
  return input.record.cleanup.kind === 'failed'
    ? {
        kind: 'failed' as const,
        error: redactError({
          error: input.record.cleanup.error,
          location: 'cleanup.error',
          context,
        }),
      }
    : input.record.cleanup;
}

function activityTelemetry(
  input: CapsuleReportProjectionInput,
  context: ReturnType<typeof createRedactionContext>,
) {
  return input.activities.map((activity) => {
    const observation = input.activityObservations.find(
      (item) => item.activityId === activity.activityId,
    );
    return observation
      ? projectActivityTelemetry(observation, context, activity.telemetry.context.traceId)
      : {
          kind: 'unavailable' as const,
          activityId: activity.activityId,
          reason: 'not-retained' as const,
        };
  });
}

/** The session fields, redacted, with the time its evidence last changed. */
function sessionProjection(
  input: CapsuleReportProjectionInput,
  context: ReturnType<typeof createRedactionContext>,
): CapsuleReportDocument['session'] {
  return {
    sessionId: input.record.sessionId,
    system: input.record.system,
    title: input.record.title,
    description:
      input.record.description.kind === 'omitted'
        ? input.record.description
        : {
            kind: 'provided' as const,
            value: redactText(input.record.description.value, 'session.description', context),
          },
    retainedState: input.record.state,
    admittedAt: input.record.admittedAt,
    updatedAt: evidenceUpdatedAt({
      recordUpdatedAt: input.record.updatedAt,
      activities: input.activities,
      progress: input.progress,
    }),
    artifactRoot: redactText(input.record.artifactRoot, 'session.artifactRoot', context),
  };
}

export function projectCapsuleReport(input: CapsuleReportProjectionInput): CapsuleReportDocument {
  const context = createRedactionContext();
  const cleanup = cleanupProjection(input, context);
  const entrypoint = input.record.entrypoint;
  const readiness = input.record.readiness;
  const session = sessionProjection(input, context);
  const document = {
    schemaVersion: 1,
    kind: 'capsule-operational-report',
    generatedAt: input.generatedAt,
    session,
    lifecycle: lifecycle(input.record.state),
    observationPolicy: projectObservationPolicy(input.progress),
    composeProject: input.record.composeProject,
    entrypoint:
      entrypoint.kind === 'unavailable'
        ? entrypoint
        : {
            kind: 'available' as const,
            value: {
              ...entrypoint.value,
              url: redactText(entrypoint.value.url, 'entrypoint.url', context),
            },
          },
    resources: {
      containers: input.record.containers,
      infrastructure: infrastructureContainers({
        containers: input.record.containers,
        progress: input.progress,
      }),
      networks: input.record.networks,
      volumes: input.record.volumes,
    },
    readiness:
      readiness.kind === 'unavailable'
        ? readiness
        : {
            kind: 'available' as const,
            value: {
              ...readiness.value,
              url: redactText(readiness.value.url, 'readiness.url', context),
            },
          },
    activities: redactActivities({ activities: input.activities, context }),
    progress: redactProgress({ events: input.progress, context }),
    activityTelemetry: activityTelemetry(input, context),
    observations: projectObservations({
      observations: input.observations,
      traceObservations: input.traceObservations,
      activities: input.activities,
      context,
    }),
    cleanup,
    failure:
      input.record.failure.kind === 'none'
        ? input.record.failure
        : {
            kind: 'recorded' as const,
            error: redactError({
              error: input.record.failure.error,
              location: 'failure.error',
              context,
            }),
          },
    ...projectCausality({
      state: input.record.state,
      observations: input.observations,
      traceObservations: input.traceObservations,
      activities: input.activities,
      context,
    }),
  } satisfies Omit<CapsuleReportBody, 'redactions'> & CapsuleReportCausality;
  return {
    ...document,
    redactions: { count: context.entries.length, entries: context.entries },
  };
}
