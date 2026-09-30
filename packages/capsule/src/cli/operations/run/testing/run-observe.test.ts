import assert from 'node:assert/strict';
import test from 'node:test';

import { observeRun } from '../run-observe.js';
import type { RunSnapshot } from '../run-telemetry.js';
import type { WaitClock } from '../run-wait.js';
import { investigation, named, running } from './run-recorded.fixture.js';

/** A clock that only moves when the wait sleeps. */
function clock() {
  let now = 0;
  return {
    now: () => now,
    sleep: (milliseconds: number) => {
      now += milliseconds;
      return Promise.resolve();
    },
  } satisfies WaitClock;
}

/**
 * Every span read returns a new snapshot, recorded in order, so tests can tell
 * them apart. `totals` is what successive counter polls return (then its last value).
 */
async function telemetry(input: {
  readonly stateChanges: boolean;
  readonly totals: readonly number[];
}) {
  const recorded = await running();
  const activity = named(recorded, 'Create Alice subscription');
  const reads: RunSnapshot[] = [];
  const totals = input.totals;
  let sessions = 0;
  let polls = 0;
  return {
    reads,
    sessions: () => sessions,
    polls: () => polls,
    source: {
      acceptedSpans: () => {
        polls += 1;
        return Promise.resolve(totals[Math.min(polls, totals.length) - 1] ?? null);
      },
      session: () => {
        sessions += 1;
        return Promise.resolve(null);
      },
      snapshot: () => {
        const snapshot = { activity, investigation: investigation(recorded) };
        reads.push(snapshot);
        return Promise.resolve(snapshot);
      },
      stateChanged: () => Promise.resolve(input.stateChanges),
    },
  };
}

function observe(source: Awaited<ReturnType<typeof telemetry>>['source'], capMs = 0) {
  return observeRun({
    telemetry: source,
    capMs,
    clock: clock(),
    signal: new AbortController().signal,
    draw: () => undefined,
  });
}

void test('a capsule that stopped during the wait gets a final snapshot from a fresh session', async () => {
  const fake = await telemetry({ stateChanges: true, totals: [] });
  const observed = await observe(fake.source);
  assert.ok(observed !== null);
  assert.equal(fake.reads.length, 2);
  assert.equal(fake.sessions(), 2);
  assert.equal(observed.snapshot, fake.reads[1]);
});

void test('an unchanged capsule is not re-read after the wait', async () => {
  const fake = await telemetry({ stateChanges: false, totals: [] });
  const observed = await observe(fake.source);
  assert.ok(observed !== null);
  assert.equal(fake.reads.length, 1);
  assert.equal(fake.sessions(), 1);
  assert.equal(observed.snapshot, fake.reads[0]);
});

void test('polls read only the lifecycle counter; the session is re-read only when it changes', async () => {
  // Unreadable at child exit (null), then the counter reads 4 and stays put: one change.
  const fake = await telemetry({ stateChanges: false, totals: [4] });
  await observe(fake.source, 5000);
  assert.ok(fake.polls() >= 5, String(fake.polls()));
  // One session read at child exit, one for the single change.
  assert.equal(fake.sessions(), 2);
  assert.equal(fake.reads.length, 2);
});
