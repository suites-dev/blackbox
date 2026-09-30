import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_WAIT_CAP_MS,
  WAIT_POLL_MS,
  WAIT_QUIET_MS,
  waitForTelemetry,
  type WaitClock,
} from '../run-wait.js';

/** A clock that only moves when the wait sleeps; `onSleep` can abort mid-wait. */
function fakeClock(onSleep: (now: number) => void = () => undefined) {
  let now = 0;
  const sleeps: number[] = [];
  const clock = {
    now: () => now,
    sleep: (milliseconds: number) => {
      sleeps.push(milliseconds);
      now += milliseconds;
      onSleep(now);
      return Promise.resolve();
    },
  } satisfies WaitClock;
  return { clock, sleeps, at: () => now };
}

/** accepted-span totals by poll time: the latest entry at or before `now`. */
function totals(schedule: readonly (readonly [number, number])[], now: () => number) {
  const polls: number[] = [];
  return {
    polls,
    poll: () => {
      polls.push(now());
      let total = 0;
      for (const [at, value] of schedule) {
        if (at <= now()) {
          total = value;
        }
      }
      return Promise.resolve(total);
    },
  };
}

void test('the wait ends after a quiet period with no new span', async () => {
  const fake = fakeClock();
  // Spans arrive at 300 ms and 600 ms, then nothing more.
  const source = totals(
    [
      [0, 3],
      [300, 5],
      [600, 9],
    ],
    fake.at,
  );
  let rereads = 0;
  const wait = await waitForTelemetry({
    capMs: DEFAULT_WAIT_CAP_MS,
    clock: fake.clock,
    signal: new AbortController().signal,
    baseline: 3,
    poll: source.poll,
    arrived: () => {
      rereads += 1;
      return Promise.resolve();
    },
  });
  // The last arrival is seen at the 600 ms poll; the wait ends 750 ms later.
  assert.deepEqual(wait, { waitedMs: 600 + WAIT_QUIET_MS, stillArriving: false });
  assert.equal(rereads, 2);
  assert.ok(fake.sleeps.every((milliseconds) => milliseconds === WAIT_POLL_MS));
});

void test('with nothing arriving the wait ends after one quiet period', async () => {
  const fake = fakeClock();
  const source = totals([[0, 4]], fake.at);
  const wait = await waitForTelemetry({
    capMs: DEFAULT_WAIT_CAP_MS,
    clock: fake.clock,
    signal: new AbortController().signal,
    baseline: 4,
    poll: source.poll,
    arrived: () => Promise.reject(new Error('nothing changed; spans must not be re-read')),
  });
  assert.deepEqual(wait, { waitedMs: WAIT_QUIET_MS, stillArriving: false });
});

void test('the cap ends a wait while spans are still arriving', async () => {
  const fake = fakeClock();
  // A new span every 300 ms, forever.
  const schedule = Array.from({ length: 100 }, (_, index) => [index * 300, index] as const);
  const source = totals(schedule, fake.at);
  const wait = await waitForTelemetry({
    capMs: 2000,
    clock: fake.clock,
    signal: new AbortController().signal,
    baseline: 0,
    poll: source.poll,
    arrived: () => Promise.resolve(),
  });
  assert.deepEqual(wait, { waitedMs: 2000, stillArriving: true });
  // The cap is never overshot: the last sleep is shortened to land on it.
  assert.equal(
    fake.sleeps.reduce((sum, milliseconds) => sum + milliseconds, 0),
    2000,
  );
});

void test('a cap shorter than the quiet period with nothing arriving is not still-arriving', async () => {
  const fake = fakeClock();
  const source = totals([[0, 1]], fake.at);
  const wait = await waitForTelemetry({
    capMs: 400,
    clock: fake.clock,
    signal: new AbortController().signal,
    baseline: 1,
    poll: source.poll,
    arrived: () => Promise.resolve(),
  });
  assert.deepEqual(wait, { waitedMs: 400, stillArriving: false });
});

void test('--wait 0 reads what has arrived and never polls', async () => {
  const fake = fakeClock();
  const source = totals([[0, 1]], fake.at);
  const wait = await waitForTelemetry({
    capMs: 0,
    clock: fake.clock,
    signal: new AbortController().signal,
    baseline: 1,
    poll: source.poll,
    arrived: () => Promise.resolve(),
  });
  assert.deepEqual(wait, { waitedMs: 0, stillArriving: false });
  assert.deepEqual(source.polls, []);
  assert.deepEqual(fake.sleeps, []);
});

void test('Ctrl-C stops the wait at once, even while spans arrive', async () => {
  const controller = new AbortController();
  const fake = fakeClock((now) => {
    if (now >= 450) {
      controller.abort();
    }
  });
  const schedule = Array.from({ length: 100 }, (_, index) => [index * 100, index] as const);
  const source = totals(schedule, fake.at);
  const wait = await waitForTelemetry({
    capMs: DEFAULT_WAIT_CAP_MS,
    clock: fake.clock,
    signal: controller.signal,
    baseline: 0,
    poll: source.poll,
    arrived: () => Promise.resolve(),
  });
  assert.deepEqual(wait, { waitedMs: 450, stillArriving: false });
  // No poll after the interrupt.
  assert.ok(source.polls.every((at) => at < 450));
});

void test('spans are re-read only when the accepted-span total changes', async () => {
  const fake = fakeClock();
  const source = totals(
    [
      [0, 2],
      [150, 2],
      [300, 7],
      [450, 7],
      [600, 7],
      [750, 8],
    ],
    fake.at,
  );
  const rereadAt: number[] = [];
  await waitForTelemetry({
    capMs: DEFAULT_WAIT_CAP_MS,
    clock: fake.clock,
    signal: new AbortController().signal,
    baseline: 2,
    poll: source.poll,
    arrived: () => {
      rereadAt.push(fake.at());
      return Promise.resolve();
    },
  });
  assert.deepEqual(rereadAt, [300, 750]);
  assert.ok(source.polls.length > rereadAt.length);
});

void test('an unreadable total never counts as an arrival', async () => {
  const fake = fakeClock();
  const wait = await waitForTelemetry({
    capMs: DEFAULT_WAIT_CAP_MS,
    clock: fake.clock,
    signal: new AbortController().signal,
    baseline: null,
    poll: () => Promise.resolve(null),
    arrived: () => Promise.reject(new Error('an unreadable total is not a change')),
  });
  assert.deepEqual(wait, { waitedMs: WAIT_QUIET_MS, stillArriving: false });
});
