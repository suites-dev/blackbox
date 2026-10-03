import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import type { CapsuleActivityReport } from '@suites/blackbox-capsule';

import { activityView } from '../../inspection/show-activity.js';
import { LiveRunBlock, runBlockLines, runDocument } from '../run-block.js';
import {
  SNAPSHOTS,
  arrivedBy,
  block,
  investigation,
  multiplied,
  named,
  raw,
  running,
  short,
  text,
  waited,
} from './run-recorded.fixture.js';

function completedLater(activity: CapsuleActivityReport, ms: number): CapsuleActivityReport {
  if (activity.kind !== 'completed') {
    throw new Error('expected a completed activity');
  }
  const completedAt = new Date(Date.parse(activity.completedAt) + ms).toISOString();
  return { ...activity, completedAt };
}

/**
 * `run` renderer snapshots from `recorded-run.json` (see run-recorded.fixture.ts).
 * Update them with `node --test --test-update-snapshots` on the compiled test
 * and review the diff.
 */

void test('run block: context sent, filtered tree, uncaused traces (non-TTY)', async (t) => {
  const recorded = await running();
  // Completing 10 s later keeps all four later traces in the activity's window.
  const activity = completedLater(named(recorded, 'Create Alice subscription'), 10_000);
  const lines = runBlockLines(block(recorded, activity, waited(812)));
  t.assert.fileSnapshot(text(lines), join(SNAPSHOTS, 'run-sent.txt'), raw);
  // More than three later traces: three warnings, then one summary line.
  assert.equal(lines.filter((line) => line.startsWith('  ⚠ Blackbox cannot prove')).length, 3);
  assert.match(lines.join('\n'), /^ {2}⚠ … \d+ more traces with no known cause$/mu);
});

void test('run block: drawn at child exit and redrawn in place as spans arrive (TTY)', async (t) => {
  const recorded = await running();
  const activity = named(recorded, 'Create Alice subscription');
  const writes: string[] = [];
  const live = new LiveRunBlock({
    write: (chunk) => writes.push(chunk),
    viewport: () => ({ columns: 160, rows: 60 }),
  });
  live.draw(block(arrivedBy(recorded, activity, 0), activity, waited(0)));
  live.draw(block(arrivedBy(recorded, activity, 165), activity, waited(300)));
  live.draw(block(recorded, activity, waited(450)));
  const final = runBlockLines(block(recorded, activity, waited(1200)));
  live.end(final);
  // One JSON string per write, so every cursor movement stays visible.
  t.assert.fileSnapshot(
    text(writes.map((chunk) => JSON.stringify(chunk))),
    join(SNAPSHOTS, 'run-tty-redraw.txt'),
    raw,
  );
  assert.ok(
    (writes.at(-1) ?? '').endsWith(`${final.join('\n')}\n`),
    'the full block is written last',
  );
});

void test('run block: a small terminal gets fewer tree lines, never other text', async () => {
  const recorded = await running();
  const activity = named(recorded, 'Reset fixture');
  const writes: string[] = [];
  const live = new LiveRunBlock({
    write: (chunk) => writes.push(chunk),
    viewport: () => ({ columns: 160, rows: 12 }),
  });
  live.draw(block(recorded, activity, waited(300)));
  const frame = writes.join('');
  assert.match(frame, /… \d+ more spans/u);
  assert.doesNotMatch(frame, /steps retained in the report/u);
  assert.ok(frame.split('\r\n').length <= 11, frame);
});

void test('run block: --wait 0 prints what had arrived when the child exited', async (t) => {
  const recorded = await running();
  const activity = named(recorded, 'Create Alice subscription');
  const lines = runBlockLines(block(arrivedBy(recorded, activity, 0), activity, waited(0)));
  t.assert.fileSnapshot(text(lines), join(SNAPSHOTS, 'run-wait-0.txt'), raw);
});

void test('run block: the cap ended the wait while spans were still arriving', async (t) => {
  const recorded = await running();
  const activity = named(recorded, 'Create Alice subscription');
  const input = block(arrivedBy(recorded, activity, 165), activity, {
    waitedMs: 5000,
    stillArriving: true,
  });
  t.assert.fileSnapshot(text(runBlockLines(input)), join(SNAPSHOTS, 'run-still-arriving.txt'), raw);
  const document = runDocument(input) as {
    observation: { waitedMs: number; stillArriving: boolean };
    limitations: readonly { kind: string }[];
  };
  assert.equal(document.observation.waitedMs, 5000);
  assert.equal(document.observation.stillArriving, true);
  assert.deepEqual(document.limitations.at(-1), { kind: 'still-arriving', waitedMs: 5000 });
  // Negative control: without the cap there is no line and no limitation.
  const quiet = { ...input, wait: waited(900) };
  assert.doesNotMatch(runBlockLines(quiet).join('\n'), /still arriving/u);
  assert.ok(
    !(runDocument(quiet) as { limitations: readonly { kind: string }[] }).limitations.some(
      (limitation) => limitation.kind === 'still-arriving',
    ),
  );
});

void test('run block: nothing observed yet', async (t) => {
  const recorded = await running();
  const activity = named(recorded, 'Create Alice subscription');
  // The instant the child exited, before any span of its trace had ended.
  const empty = {
    ...recorded,
    traces: recorded.traces.map((trace) =>
      trace.traceId === activity.telemetry.context.traceId ? { ...trace, spans: [] } : trace,
    ),
  };
  const lines = runBlockLines(block(arrivedBy(empty, activity, 0), activity, waited(0)));
  t.assert.fileSnapshot(text(lines), join(SNAPSHOTS, 'run-nothing-observed.txt'), raw);
  assert.ok(lines.includes('  observed  nothing yet · provisional (capsule running)'));
});

void test('run block: shared-state driver context', async (t) => {
  const recorded = await running();
  const activity = named(recorded, 'Queue proof stimulus');
  const lines = runBlockLines(block(recorded, activity, waited(987)));
  t.assert.fileSnapshot(text(lines), join(SNAPSHOTS, 'run-shared-state.txt'), raw);
});

void test('run block: untraced host command', async (t) => {
  const recorded = await running();
  const activity = named(recorded, 'Check health once more');
  const lines = runBlockLines(block(recorded, activity, waited(751)));
  t.assert.fileSnapshot(text(lines), join(SNAPSHOTS, 'run-untraced.txt'), raw);
});

void test('run block: orphans keep their mark when lifted to the root', async (t) => {
  const recorded = await running();
  const activity = named(recorded, 'Create Alice subscription');
  const contextSpan = activity.telemetry.context.spanId;
  // The activity's server span has not arrived: its children name a parent
  // that is not (yet) retained.
  const orphaned = {
    ...recorded,
    traces: recorded.traces.map((trace) =>
      trace.traceId === activity.telemetry.context.traceId
        ? { ...trace, spans: trace.spans.filter((span) => span.parentSpanId !== contextSpan) }
        : trace,
    ),
  };
  const lines = runBlockLines(block(orphaned, activity, waited(760)));
  t.assert.fileSnapshot(text(lines), join(SNAPSHOTS, 'run-orphan.txt'), raw);
  // fraud-check's server span hung under an HTTP client orphan: lifted, still marked.
  assert.ok(lines.includes('    fraud-check  POST /assess  200  (parent not yet observed)'));
});

void test('run block: at most 40 tree lines, then how many more', async (t) => {
  const recorded = await running();
  const activity = named(recorded, 'Create Alice subscription');
  const many = multiplied(recorded, activity.telemetry.context.traceId, 3);
  const lines = runBlockLines(block(many, activity, waited(900)));
  t.assert.fileSnapshot(text(lines), join(SNAPSHOTS, 'run-many-spans.txt'), raw);
  const tree = lines.slice(lines.findIndex((line) => line.startsWith('  observed')) + 1);
  const more = tree.findIndex((line) => /^ {4}… \d+ more spans$/u.test(line));
  assert.equal(more, 40);
  // show keeps printing every span.
  const shown = activityView({
    short: short(activity.activityId),
    activity,
    investigation: investigation(many),
  }).lines;
  assert.ok(shown.filter((line) => line.startsWith('    ')).length > 60);
});
