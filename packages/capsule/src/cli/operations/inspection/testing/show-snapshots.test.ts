import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import {
  observationCompleteness,
  type CapsuleActivityReport,
  type CapsuleObservationsResult,
  type CapsuleReportSpan,
  type CapsuleSessionState,
} from '@suites/blackbox-capsule';

import type { CapsuleSummary } from '../../../context/project-index.js';
import { CapsuleInvestigation } from '../investigation-model.js';
import { activityView, capsuleView, timelineView, traceView } from '../show-output.js';

/**
 * Renderer snapshots from sanitized fixtures recorded in a real e2e run; see
 * fixtures/README.md for how each fixture was captured. Update them with
 * `node --test --test-update-snapshots` on the compiled test and review the diff.
 */
// The package test runner starts every test with the package directory as cwd.
const SOURCE = join(process.cwd(), 'src/operations/inspection/testing');
const SNAPSHOTS = join(SOURCE, 'snapshots');
const FORBIDDEN_WORDS = /\b(?:success|successful|passed|verified|effects?)\b/iu;

type Lifecycle = Extract<
  CapsuleObservationsResult,
  { kind: 'collector-session-found' }
>['lifecycle'];

interface RecordedFixture {
  readonly capsule: CapsuleSummary & { readonly state: CapsuleSessionState };
  readonly lifecycle: Lifecycle | null;
  readonly activities: readonly CapsuleActivityReport[];
  readonly traces: readonly {
    readonly traceId: string;
    readonly spans: readonly CapsuleReportSpan[];
  }[];
}

async function fixture(name: string): Promise<RecordedFixture> {
  return JSON.parse(
    await readFile(join(SOURCE, 'fixtures', `${name}.json`), 'utf8'),
  ) as RecordedFixture;
}

function investigation(recorded: RecordedFixture): CapsuleInvestigation {
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

const short = (activityId: string) => activityId.slice(0, 8);

function text(view: { readonly lines: readonly string[]; readonly next: readonly string[] }) {
  return `${[...view.lines, ...view.next.map((command) => `→ ${command}`)].join('\n')}\n`;
}

function activityNamed(recorded: RecordedFixture, name: string): CapsuleActivityReport {
  const found = recorded.activities.find(
    (activity) => activity.name.kind === 'provided' && activity.name.value === name,
  );
  if (found === undefined) {
    throw new Error(`fixture has no activity named ${name}`);
  }
  return found;
}

const raw = { serializers: [(value: unknown) => String(value)] };

void test('show activity: context sent, span tree, next suggestion', async (t) => {
  const recorded = await fixture('recorded-capsule');
  const activity = activityNamed(recorded, 'Create Alice subscription');
  const view = activityView({
    short: short(activity.activityId),
    activity,
    investigation: investigation(recorded),
  });
  t.assert.fileSnapshot(text(view), join(SNAPSHOTS, 'activity-sent.txt'), raw);
});

void test('show activity: shared-state driver, nothing observed, uncaused traces', async (t) => {
  const recorded = await fixture('recorded-capsule');
  const activity = activityNamed(recorded, 'Queue proof stimulus');
  const view = activityView({
    short: short(activity.activityId),
    activity,
    investigation: investigation(recorded),
  });
  t.assert.fileSnapshot(text(view), join(SNAPSHOTS, 'activity-shared-state.txt'), raw);
});

void test('show activity: untraced host command', async (t) => {
  const recorded = await fixture('recorded-capsule');
  const activity = activityNamed(recorded, 'Check health once more');
  const view = activityView({
    short: short(activity.activityId),
    activity,
    investigation: investigation(recorded),
  });
  t.assert.fileSnapshot(text(view), join(SNAPSHOTS, 'activity-untraced.txt'), raw);
});

/**
 * The recorded capsule while still running, with the activity's server span
 * not arrived yet: its children name a parent that is not (yet) retained.
 */
function withoutServerSpan(
  recorded: RecordedFixture,
  activity: CapsuleActivityReport,
): RecordedFixture {
  const traceId = activity.telemetry.context.traceId;
  const contextSpan = activity.telemetry.context.spanId;
  return {
    ...recorded,
    capsule: { ...recorded.capsule, state: 'running' },
    traces: recorded.traces.map((trace) =>
      trace.traceId === traceId
        ? { ...trace, spans: trace.spans.filter((span) => span.parentSpanId !== contextSpan) }
        : trace,
    ),
  };
}

void test('show activity: orphan spans while provisional', async (t) => {
  const complete = await fixture('recorded-capsule');
  const recorded = withoutServerSpan(
    complete,
    activityNamed(complete, 'Create Alice subscription'),
  );
  const activity = activityNamed(recorded, 'Create Alice subscription');
  const view = activityView({
    short: short(activity.activityId),
    activity,
    investigation: investigation(recorded),
  });
  t.assert.fileSnapshot(text(view), join(SNAPSHOTS, 'activity-orphan.txt'), raw);
});

void test('show trace, show trace --spans, show capsule and --timeline', async (t) => {
  const recorded = await fixture('recorded-capsule');
  const model = investigation(recorded);
  const activity = activityNamed(recorded, 'Create Alice subscription');
  const traceId = activity.telemetry.context.traceId;
  const associated = short(activity.activityId);
  t.assert.fileSnapshot(
    text(traceView({ traceId, investigation: model, associated, spans: false })),
    join(SNAPSHOTS, 'trace.txt'),
    raw,
  );
  t.assert.fileSnapshot(
    text(traceView({ traceId, investigation: model, associated, spans: true })),
    join(SNAPSHOTS, 'trace-spans.txt'),
    raw,
  );
  const latest = short(recorded.activities[recorded.activities.length - 1].activityId);
  t.assert.fileSnapshot(
    text(
      capsuleView({
        capsule: recorded.capsule,
        completeness: model.data.completeness,
        activities: recorded.activities,
        traceCount: recorded.traces.length,
        latest,
      }),
    ),
    join(SNAPSHOTS, 'capsule.txt'),
    raw,
  );
  t.assert.fileSnapshot(
    text(timelineView({ investigation: model, short, latest })),
    join(SNAPSHOTS, 'capsule-timeline.txt'),
    raw,
  );
});

void test('word rule: no show snapshot claims success, verification or effects', async () => {
  const files = (await readdir(SNAPSHOTS)).filter((file) => file.endsWith('.txt'));
  assert.ok(files.length >= 8, `expected every show snapshot, found ${String(files.length)}`);
  for (const file of files) {
    assert.doesNotMatch(await readFile(join(SNAPSHOTS, file), 'utf8'), FORBIDDEN_WORDS, file);
  }
  // Negative control: the oracle catches every forbidden word.
  for (const word of ['success', 'Successful', 'passed', 'verified', 'effect', 'effects']) {
    assert.match(`checks ${word} here`, FORBIDDEN_WORDS, word);
  }
});
