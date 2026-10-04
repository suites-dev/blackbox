import {
  activityContext,
  type ActivityContext,
  type CapsuleActivityReport,
} from '@suites/blackbox-capsule';

import { createRedactionContext, redactText } from '../../../reporting/redaction.js';

import { formatColumns } from '../../cli/output.js';
import { nextSteps } from '../../cli/next-steps.js';
import {
  offsetMs,
  rootSummary,
  type CapsuleInvestigation,
  type TraceTree,
} from './investigation-model.js';
import {
  limitationsOf,
  NO_WAIT,
  observationDocument,
  statusDocument,
  type ActivityObservation,
  type TelemetryWait,
} from './show-json.js';
import {
  contextText,
  field,
  processText,
  serviceCounts,
  showDuration,
  statusText,
  summarizedTreeLines,
  SUMMARY_SPAN_LIMIT,
  traceShort,
  treeLines,
  viaText,
} from './show-format.js';

/** `summary` folds a large tree (identical sibling subtrees once); `full` prints every span. */
export type TreeDetail = 'summary' | 'full';

const MAX_CAUSALITY_WARNINGS = 3;

export interface ActivityViewInput {
  readonly short: string;
  readonly activity: CapsuleActivityReport;
  readonly investigation: CapsuleInvestigation;
}

/** True when a driver failed before any process existed (nothing was sent or observed). */
export function driverFailedEarly(activity: CapsuleActivityReport): boolean {
  return (
    activity.kind === 'completed' &&
    (activity.outcome.kind === 'driver-prepare-failed' ||
      activity.outcome.kind === 'driver-propagation-refused')
  );
}

function driverFailure(
  activity: CapsuleActivityReport,
):
  | { readonly kind: 'driver-prepare-failed'; readonly message: string }
  | { readonly kind: 'driver-propagation-refused' }
  | null {
  if (!driverFailedEarly(activity) || activity.kind !== 'completed') {
    return null;
  }
  if (activity.outcome.kind === 'driver-prepare-failed') {
    return {
      kind: activity.outcome.kind,
      message: redactText(
        activity.outcome.error.message,
        'activity.outcome.error.message',
        createRedactionContext(),
      ),
    };
  }
  if (activity.outcome.kind === 'driver-propagation-refused') {
    return { kind: activity.outcome.kind };
  }
  return null;
}

export function driverOf(activity: CapsuleActivityReport): string | null {
  return activity.target.kind === 'driver' ? activity.target.driverId : null;
}

/** `later in this capsule, no known cause:` rows and at most three causality warnings. */
export function uncausedLines(input: ActivityViewInput, capsule: string): readonly string[] {
  const later = input.investigation.uncausedAfter(input.activity);
  if (later.length === 0) {
    return [];
  }
  const rows = later.map((placement) => {
    const root = rootSummary(input.investigation.tree(placement.traceId));
    const after = offsetMs(input.activity.startedAt, placement.earliestStartUnixNano);
    return [
      traceShort(placement.traceId),
      root.service,
      root.title,
      root.result,
      `+${showDuration(after)}`,
    ];
  });
  const warnings = later
    .slice(0, MAX_CAUSALITY_WARNINGS)
    .flatMap((placement) => [
      `  ⚠ Blackbox cannot prove that ${input.short} caused ${traceShort(placement.traceId)}.`,
      `    Both belong to capsule ${capsule}, but no trace context links them.`,
    ]);
  const more = later.length - MAX_CAUSALITY_WARNINGS;
  return [
    '  later in this capsule, no known cause:',
    ...formatColumns(rows).map((row) => `    ${row}`),
    ...warnings,
    ...(more > 0 ? [`  ⚠ … ${String(more)} more traces with no known cause`] : []),
  ];
}

/** The SPANS block: every span, or above the limit a per-service count and a folded tree. */
function spanLines(roots: TraceTree['roots'], spans: number, detail: TreeDetail) {
  if (detail === 'full' || spans <= SUMMARY_SPAN_LIMIT) {
    return ['  SPANS', ...treeLines(roots).map((line) => `    ${line}`)];
  }
  const folded = summarizedTreeLines(roots);
  return [
    field('services', serviceCounts(roots)),
    `  SPANS (${String(spans)} spans in ${String(folded.length)} lines: identical sibling subtrees shown once, ×N)`,
    ...folded.map((line) => `    ${line}`),
    '  --full prints every span',
  ];
}

function observedLines(
  input: ActivityViewInput,
  observation: ActivityObservation,
  detail: TreeDetail,
) {
  const status = statusText(input.investigation.data.completeness);
  if (observation.spans === 0) {
    // "yet" only while more telemetry can still arrive.
    const nothing =
      input.investigation.data.completeness.status === 'provisional'
        ? 'nothing yet'
        : 'nothing observed';
    return [field('observed', `${nothing} · ${status}`)];
  }
  const tree = input.investigation.tree(input.activity.telemetry.context.traceId);
  return [
    field(
      'observed',
      `${String(observation.traces.length)} traces · ${String(observation.services.length)} services · ${String(observation.spans)} spans · ${status}`,
    ),
    ...spanLines(tree.roots, tree.spanCount, detail),
  ];
}

/**
 * `show <activity>`. Never prints the activity's argv (it can hold
 * credentials); the activity is named by its short ID and its name only.
 * `run` passes how long it waited; `show` never waits.
 */
export function activityView(
  input: ActivityViewInput,
  wait: TelemetryWait = NO_WAIT,
  detail: TreeDetail = 'summary',
) {
  const { activity, investigation } = input;
  const capsule = investigation.data.capsule;
  const name = activity.name.kind === 'provided' ? `  ${activity.name.value}` : '';
  const head = [
    `activity ${input.short}${name}`,
    field('capsule', `${capsule.capsule} (${capsule.system}, ${capsule.state})`),
    field('purpose', activity.purpose),
    field('via', viaText(activity)),
    field('process', processText(activity)),
  ];
  if (driverFailedEarly(activity)) {
    const failure = driverFailure(activity);
    const failureText =
      failure === null ? 'unknown' : 'message' in failure ? failure.message : failure.kind;
    return {
      lines: [...head, field('failure', failureText)],
      next: [],
      // No process ran, so there is no observation, but every show document
      // still carries the capsule's status.
      document: { ...statusDocument(investigation.data.completeness), failure, limitations: [] },
    };
  }
  const context: ActivityContext | null = activityContext(activity);
  const observation = observationDocument(input, wait);
  const traceId = activity.telemetry.context.traceId;
  const next = observation.spans > 0 ? [nextSteps.showTraceSpans(traceId, capsule.capsule)] : [];
  const lines = [
    ...head,
    ...(context === null ? [] : [field('context', contextText(context, driverOf(activity)))]),
    ...observedLines(input, observation, detail),
    ...uncausedLines(input, capsule.capsule),
  ];
  return {
    lines,
    next,
    document: {
      ...(context === null ? {} : { context }),
      observation,
      limitations: limitationsOf({ context, observation, investigation, traceId }),
    },
  };
}
