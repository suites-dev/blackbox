import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

import {
  isoToUnixNano,
  observationCompleteness,
  type CapsuleActivityReport,
  type CapsuleObservationsResult,
  type CapsuleReportSpan,
  type CapsuleSessionState,
} from '@suites/blackbox-capsule';

import type { CapsuleSummary } from '../../../context/project-index.js';
import { CapsuleInvestigation } from '../../inspection/investigation-model.js';
import type { TelemetryWait } from '../../inspection/show-json.js';
import type { RunBlockInput } from '../run-block.js';
import { runSummaryLines } from '../run-output.js';

/**
 * `recorded-run.json`: a capsule recorded in a real e2e run and sanitized (see
 * inspection/testing/fixtures/README.md), with each span's recorded arrival
 * time, and the `run` block inputs derived from it.
 */
// The test runner starts in the package directory; no path comes from the environment.
export const PACKAGE = process.cwd();
export const FIXTURES = join(PACKAGE, 'src/cli/operations/inspection/testing/fixtures');
export const SNAPSHOTS = join(PACKAGE, 'src/cli/operations/run/testing/snapshots');
export const FORBIDDEN_WORDS = /\b(?:success|successful|passed|verified|effects?)\b/iu;
export const raw = { serializers: [(value: unknown) => String(value)] };

type Lifecycle = Extract<
  CapsuleObservationsResult,
  { kind: 'collector-session-found' }
>['lifecycle'];

export interface RecordedFixture {
  readonly capsule: CapsuleSummary & { readonly state: CapsuleSessionState };
  readonly lifecycle: Lifecycle | null;
  readonly activities: readonly CapsuleActivityReport[];
  readonly traces: readonly {
    readonly traceId: string;
    readonly spans: readonly CapsuleReportSpan[];
    /** When the collector received each span, by span ID (recorded). */
    readonly arrivals: Readonly<Partial<Record<string, string>>>;
  }[];
}

/** The recording while its capsule still runs, as `run` sees it. */
export async function running(): Promise<RecordedFixture> {
  const recorded = JSON.parse(
    await readFile(join(FIXTURES, 'recorded-run.json'), 'utf8'),
  ) as RecordedFixture;
  return { ...recorded, capsule: { ...recorded.capsule, state: 'running' } };
}

export function named(recorded: RecordedFixture, name: string): CapsuleActivityReport {
  const found = recorded.activities.find(
    (activity) => activity.name.kind === 'provided' && activity.name.value === name,
  );
  if (found === undefined) {
    throw new Error(`fixture has no activity named ${name}`);
  }
  return found;
}

/**
 * Only the spans the collector had received `afterMs` after the activity
 * completed (the child exited), from the recorded arrival times.
 */
export function arrivedBy(
  recorded: RecordedFixture,
  activity: CapsuleActivityReport,
  afterMs: number,
): RecordedFixture {
  const completed = activity.kind === 'completed' ? activity.completedAt : activity.startedAt;
  const cutoff = (isoToUnixNano(completed) ?? 0n) + BigInt(afterMs) * 1_000_000n;
  return {
    ...recorded,
    traces: recorded.traces.map((trace) => ({
      ...trace,
      spans: trace.spans.filter((span) => {
        const received = trace.arrivals[span.spanId];
        if (received === undefined) {
          throw new Error(`fixture has no arrival time for span ${span.spanId}`);
        }
        return (isoToUnixNano(received) ?? 0n) <= cutoff;
      }),
    })),
  };
}

export function investigation(recorded: RecordedFixture): CapsuleInvestigation {
  return new CapsuleInvestigation({
    capsule: recorded.capsule,
    completeness: observationCompleteness({
      state: recorded.capsule.state,
      lifecycle: recorded.lifecycle,
    }),
    activities: recorded.activities,
    traces: recorded.traces,
  });
}

export const short = (activityId: string) => activityId.slice(0, 8);

export function block(
  recorded: RecordedFixture,
  activity: CapsuleActivityReport,
  wait: TelemetryWait,
): RunBlockInput {
  const capsule = recorded.capsule.capsule;
  if (activity.kind !== 'completed') {
    throw new Error(`run shows completed activities only, not ${activity.kind}`);
  }
  const [runLine] = runSummaryLines({
    activity: short(activity.activityId),
    capsule,
    purpose: activity.purpose,
    driver: activity.target.kind === 'driver' ? activity.target.driverId : null,
    outcome: activity.outcome,
    // A fixed duration keeps the run line stable across snapshots.
    durationMs: 284,
  });
  return {
    runLine,
    short: short(activity.activityId),
    snapshot: { activity, investigation: investigation(recorded) },
    wait,
    next: [`blackbox capsule show ${short(activity.activityId)} --session ${capsule}`],
  };
}

export const text = (lines: readonly string[]) => `${lines.join('\n')}\n`;
export const waited = (waitedMs: number): TelemetryWait => ({ waitedMs, stillArriving: false });

/** The recorded trace with every non-root span copied `copies` more times under the same parents. */
export function multiplied(
  recorded: RecordedFixture,
  traceId: string,
  copies: number,
): RecordedFixture {
  return {
    ...recorded,
    traces: recorded.traces.map((trace) => {
      if (trace.traceId !== traceId) {
        return trace;
      }
      const root = new Set(
        trace.spans.filter((span) => !trace.spans.some((p) => p.spanId === span.parentSpanId)),
      );
      const extra = Array.from({ length: copies }, (_, copy) =>
        trace.spans
          .filter((span) => !root.has(span))
          .map((span) => ({
            ...span,
            spanId: `${span.spanId.slice(0, 14)}${String(copy + 10)}`,
            parentSpanId: trace.spans.some((p) => p.spanId === span.parentSpanId && root.has(p))
              ? span.parentSpanId
              : `${(span.parentSpanId ?? '').slice(0, 14)}${String(copy + 10)}`,
          })),
      ).flat();
      return { ...trace, spans: [...trace.spans, ...extra] };
    }),
  };
}
