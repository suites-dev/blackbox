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

/** Every span read returns a new snapshot, recorded in order, so tests can tell them apart. */
async function telemetry(input: { readonly stateChanges: boolean }) {
  const recorded = await running();
  const activity = named(recorded, 'Create Alice subscription');
  const reads: RunSnapshot[] = [];
  let sessions = 0;
  return {
    reads,
    sessions: () => sessions,
    source: {
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

function observe(source: Awaited<ReturnType<typeof telemetry>>['source']) {
  return observeRun({
    telemetry: source,
    capMs: 0,
    clock: clock(),
    signal: new AbortController().signal,
    draw: () => undefined,
  });
}

void test('a capsule that stopped during the wait gets a final snapshot from a fresh session', async () => {
  const fake = await telemetry({ stateChanges: true });
  const observed = await observe(fake.source);
  assert.ok(observed !== null);
  assert.equal(fake.reads.length, 2);
  assert.equal(fake.sessions(), 2);
  assert.equal(observed.snapshot, fake.reads[1]);
});

void test('an unchanged capsule is not re-read after the wait', async () => {
  const fake = await telemetry({ stateChanges: false });
  const observed = await observe(fake.source);
  assert.ok(observed !== null);
  assert.equal(fake.reads.length, 1);
  assert.equal(fake.sessions(), 1);
  assert.equal(observed.snapshot, fake.reads[0]);
});
