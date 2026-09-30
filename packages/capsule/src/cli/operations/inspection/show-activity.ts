import {
  activityContext,
  type ActivityContext,
  type CapsuleActivityReport,
} from '@suites/blackbox-capsule';

import { formatColumns } from '../../cli/output.js';
import { nextSteps } from '../../cli/next-steps.js';
import { offsetMs, rootSummary, type CapsuleInvestigation } from './investigation-model.js';
import { limitationsOf, observationDocument, type ActivityObservation } from './show-json.js';
import {
  contextText,
  field,
  processText,
  showDuration,
  statusText,
  traceShort,
  treeLines,
  viaText,
} from './show-format.js';

const MAX_CAUSALITY_WARNINGS = 3;

export interface ActivityViewInput {
  readonly short: string;
  readonly activity: CapsuleActivityReport;
  readonly investigation: CapsuleInvestigation;
}

/** True when a driver failed before any process existed (nothing was sent or observed). */
function driverFailedEarly(activity: CapsuleActivityReport): boolean {
  return (
    activity.kind === 'completed' &&
    (activity.outcome.kind === 'driver-prepare-failed' ||
      activity.outcome.kind === 'driver-propagation-refused')
  );
}

function driverOf(activity: CapsuleActivityReport): string | null {
  return activity.target.kind === 'driver' ? activity.target.driverId : null;
}

function uncausedLines(input: ActivityViewInput, capsule: string): readonly string[] {
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

function observedLines(input: ActivityViewInput, observation: ActivityObservation) {
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
    '  SPANS',
    ...treeLines(tree.roots).map((line) => `    ${line}`),
  ];
}

/**
 * `show <activity>`. Never prints the activity's argv (it can hold
 * credentials); the activity is named by its short ID and its name only.
 */
export function activityView(input: ActivityViewInput) {
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
    return { lines: head, next: [], document: { limitations: [] } };
  }
  const context: ActivityContext | null = activityContext(activity);
  const observation = observationDocument(input);
  const traceId = activity.telemetry.context.traceId;
  const next = observation.spans > 0 ? [nextSteps.showTraceSpans(traceId, capsule.capsule)] : [];
  const lines = [
    ...head,
    ...(context === null ? [] : [field('context', contextText(context, driverOf(activity)))]),
    ...observedLines(input, observation),
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
