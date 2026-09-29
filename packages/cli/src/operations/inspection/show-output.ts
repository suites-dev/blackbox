import type {
  CapsuleActivityReport,
  CapsuleObservationsResult,
} from '@suites/blackbox-capsule';

import { nextSteps } from '../../cli/next-steps.js';
import type { CapsuleSummary } from '../../context/project-index.js';
import { locationText, processOutcome } from '../run/run-output.js';

const MAX_TRACE_SUGGESTIONS = 3;

export function processLine(activity: CapsuleActivityReport): string {
  if (activity.kind !== 'completed') {
    return activity.kind;
  }
  const process = processOutcome(activity.outcome);
  if (process === null) {
    return `not run: ${activity.outcome.kind}`;
  }
  const on = ` on ${locationText(process.location)}`;
  switch (process.kind) {
    case 'exited':
      return `exited ${String(process.exitCode)}${on}`;
    case 'signaled':
      return `signaled ${process.signal}${on}`;
    case 'executable-not-found':
      return `not found${on}`;
  }
}

export function observedTraceIds(result: CapsuleObservationsResult): readonly string[] {
  return result.kind === 'collector-activity-found' || result.kind === 'collector-session-found'
    ? result.traceIds
    : [];
}

function arrayField(value: unknown, key: string): readonly unknown[] {
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  const field: unknown = (value as Readonly<Record<string, unknown>>)[key];
  return Array.isArray(field) ? field : [];
}

/** Counts the spans across retained OTLP/JSON trace fragments. */
export function spanCount(result: CapsuleObservationsResult): number {
  if (result.kind !== 'collector-trace-found') {
    return 0;
  }
  let count = 0;
  for (const fragment of result.fragments) {
    for (const resource of arrayField(fragment.request, 'resourceSpans')) {
      for (const scope of arrayField(resource, 'scopeSpans')) {
        count += arrayField(scope, 'spans').length;
      }
    }
  }
  return count;
}

export function activityView(input: {
  readonly short: string;
  readonly capsule: CapsuleSummary;
  readonly activity: CapsuleActivityReport;
  readonly result: CapsuleObservationsResult;
}) {
  const { capsule, activity } = input;
  const traces = observedTraceIds(input.result);
  const next = traces
    .slice(0, MAX_TRACE_SUGGESTIONS)
    .map((trace) => nextSteps.showTrace(trace, capsule.capsule));
  const name = activity.name.kind === 'provided' ? `  ${activity.name.value}` : '';
  const lines = [
    `activity ${input.short}${name}`,
    `  ${'capsule'.padEnd(10)}${capsule.capsule} (${capsule.system}, ${capsule.state})`,
    `  ${'purpose'.padEnd(10)}${activity.purpose}`,
    `  ${'process'.padEnd(10)}${processLine(activity)}`,
    `  ${'observed'.padEnd(10)}${input.result.kind} · ${String(traces.length)} traces`,
  ];
  return { lines, next };
}

export function capsuleView(input: {
  readonly capsule: CapsuleSummary;
  /** null when the capsule's activity record could not be read (shown as `?`, like `ls`). */
  readonly activities: readonly CapsuleActivityReport[] | null;
  readonly latest: string | null;
  readonly result: CapsuleObservationsResult;
}) {
  const { capsule } = input;
  const next = input.latest === null ? [] : [nextSteps.showActivity(input.latest, capsule.capsule)];
  const activities = input.activities === null ? '?' : String(input.activities.length);
  const lines = [
    `capsule ${capsule.capsule}  ${capsule.system}  ${capsule.state}`,
    `  activities ${activities} · traces ${String(observedTraceIds(input.result).length)}`,
  ];
  return { lines, next };
}

export function traceView(input: {
  readonly traceId: string;
  readonly capsule: CapsuleSummary;
  readonly associated: string | null;
  readonly result: CapsuleObservationsResult;
}) {
  const next =
    input.associated === null
      ? []
      : [nextSteps.showActivity(input.associated, input.capsule.capsule)];
  const lines = [
    `trace ${input.traceId} · capsule ${input.capsule.capsule} · ${String(spanCount(input.result))} spans`,
  ];
  return { lines, next };
}
