import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import {
  causalityFromTraces,
  observationCompleteness,
  type CapsuleActivityReport,
  type CapsuleObservationsResult,
  type CapsuleReportActivityCausality,
  type CapsuleReportSpan,
  type CapsuleSessionState,
} from '@suites/blackbox-capsule';

import type { CapsuleSummary } from '../context/project-index.js';
import { CapsuleInvestigation, rootSummary } from '../operations/inspection/investigation-model.js';
import { limitationsOf, observationDocument } from '../operations/inspection/show-json.js';

/**
 * The report and `capsule show --json` read the same recorded capsule. The
 * fixture is the one the show snapshots render (see its README); it is read,
 * never changed, here.
 */
const FIXTURE = join(
  process.cwd(),
  'src/cli/operations/inspection/testing/fixtures/recorded-capsule.json',
);
const FORBIDDEN_WORDS = /\b(?:success|successful|passed|verified|effects?)\b/iu;

type Lifecycle = Extract<
  CapsuleObservationsResult,
  { kind: 'collector-session-found' }
>['lifecycle'];

interface Recorded {
  readonly capsule: CapsuleSummary & { readonly state: CapsuleSessionState };
  readonly lifecycle: Lifecycle | null;
  readonly activities: readonly CapsuleActivityReport[];
  readonly traces: readonly {
    readonly traceId: string;
    readonly spans: readonly CapsuleReportSpan[];
  }[];
}

async function recorded(
  change: (fixture: Recorded) => Recorded = (fixture) => fixture,
): Promise<Recorded> {
  return change(JSON.parse(await readFile(FIXTURE, 'utf8')) as Recorded);
}

function show(fixture: Recorded): CapsuleInvestigation {
  return new CapsuleInvestigation({
    capsule: fixture.capsule,
    completeness: observationCompleteness({
      state: fixture.capsule.state,
      lifecycle: fixture.lifecycle,
    }),
    activities: fixture.activities,
    traces: fixture.traces,
  });
}

function reportOf(fixture: Recorded) {
  return causalityFromTraces({
    completeness: observationCompleteness({
      state: fixture.capsule.state,
      lifecycle: fixture.lifecycle,
    }),
    activities: fixture.activities,
    traces: fixture.traces.map((trace) => ({
      traceId: trace.traceId,
      spans: trace.spans,
      unavailable: trace.spans.length === 0 ? ('not-retained' as const) : null,
    })),
  });
}

function causalityOf(
  report: ReturnType<typeof reportOf>,
  activity: CapsuleActivityReport,
): CapsuleReportActivityCausality {
  const found = report.activityCausality.find((item) => item.activityId === activity.activityId);
  assert.ok(found, `report has ${activity.activityId}`);
  return found;
}

void test('every activity: the report states the status, causes, trees and unknown causes `show --json` does', async () => {
  const fixture = await recorded();
  const investigation = show(fixture);
  const report = reportOf(fixture);
  assert.equal(report.status, 'complete');
  let causedAny = false;
  for (const activity of fixture.activities) {
    const shown = observationDocument({ activity, investigation });
    const reported = causalityOf(report, activity);
    assert.deepEqual(
      reported.causedTraces.map((trace) => trace.traceId),
      shown.traces,
    );
    assert.deepEqual(
      reported.causedTraces.flatMap((trace) => trace.tree),
      shown.tree,
    );
    assert.deepEqual(
      reported.limitations.filter((item) => item.kind === 'causality-unknown'),
      shown.uncaused.map(({ trace }) => ({ kind: 'causality-unknown', trace })),
    );
    causedAny ||= shown.spans > 0;
  }
  assert.ok(causedAny, 'the fixture has an activity with a caused trace');
  assert.deepEqual(
    report.uncaused,
    investigation.uncaused().map((placement) => ({
      trace: placement.traceId,
      placedAfter: placement.placedAfter,
      rootService: rootSummary(investigation.tree(placement.traceId)).service,
      rootTitle: rootSummary(investigation.tree(placement.traceId)).title,
    })),
  );
});

void test('limitations use the kinds show uses for the same activities', async () => {
  const fixture = await recorded();
  const investigation = show(fixture);
  const report = reportOf(fixture);
  for (const activity of fixture.activities) {
    const observation = observationDocument({ activity, investigation });
    const traceId = activity.telemetry.context.traceId;
    const shown = limitationsOf({
      context: causalityOf(report, activity).context,
      observation,
      investigation,
      traceId,
    }).map((item) => item.kind);
    const reported = causalityOf(report, activity)
      .limitations.map((item) => item.kind)
      .filter((kind) => kind !== 'observation-unavailable');
    assert.deepEqual(reported, shown, activity.activityId);
  }
});

void test('a capsule still running is provisional', async () => {
  const fixture = await recorded((value) => ({
    ...value,
    capsule: { ...value.capsule, state: 'running' },
  }));
  const report = reportOf(fixture);
  assert.equal(report.status, 'provisional');
  assert.deepEqual(report.limitations[0], { kind: 'observation-provisional' });
});

void test('report text uses none of the words the CLI avoids', async () => {
  const report = reportOf(await recorded());
  assert.doesNotMatch(JSON.stringify(report.limitations), FORBIDDEN_WORDS);
});
