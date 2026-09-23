import assert from 'node:assert/strict';
import test from 'node:test';

import {
  drainQueueWithPort,
  QueueCleanupError,
  type QueueCleanupClock,
  type QueueCleanupPort,
  type QueueMessage,
} from './queue.js';

function manualClock(): QueueCleanupClock & { readonly time: () => number } {
  let time = 0;
  return {
    now: () => time,
    sleep: (milliseconds) => {
      time += milliseconds;
      return Promise.resolve();
    },
    time: () => time,
  };
}

void test('cleanup observes a stable empty interval and drains a message that appears late', async () => {
  const clock = manualClock();
  let receiveCount = 0;
  let present = false;
  const deleted: string[] = [];
  const lateMessage = {
    body: '{"userId":"late"}',
    receiptHandle: 'receipt-late',
  } satisfies QueueMessage;
  const port = {
    counts() {
      return Promise.resolve({ delayed: 0, inFlight: 0, visible: present ? 1 : 0 });
    },
    deleteBatch(entries) {
      deleted.push(...entries.map(({ receiptHandle }) => receiptHandle));
      present = false;
      return Promise.resolve([]);
    },
    receive() {
      receiveCount += 1;
      if (receiveCount === 3) {
        present = true;
        return Promise.resolve([lateMessage]);
      }
      if (present) {
        return Promise.resolve([lateMessage]);
      }
      return Promise.resolve([]);
    },
  } satisfies QueueCleanupPort;

  const messages = await drainQueueWithPort(port, {
    clock,
    deadlineMs: 500,
    pollIntervalMs: 10,
    stableEmptyMs: 40,
  });
  assert.deepEqual(messages, [{ userId: 'late' }]);
  assert.deepEqual(deleted, ['receipt-late']);
  assert.equal(clock.time() >= 60, true);
});

void test('cleanup refuses a failed batch deletion instead of claiming empty', async () => {
  const port = {
    counts: () => Promise.resolve({ delayed: 0, inFlight: 0, visible: 1 }),
    deleteBatch: () => Promise.resolve([{ code: 'InternalError', id: 'message-0' }]),
    receive: () =>
      Promise.resolve([{ body: '{"userId":"alice"}', receiptHandle: 'receipt-alice' }]),
  } satisfies QueueCleanupPort;
  await assert.rejects(
    drainQueueWithPort(port, {
      clock: manualClock(),
      deadlineMs: 100,
      pollIntervalMs: 10,
      stableEmptyMs: 20,
    }),
    (error: unknown) => error instanceof QueueCleanupError && error.code === 'queue-delete-failed',
  );
});

void test('cleanup fails at its deadline while in-flight messages remain', async () => {
  const port = {
    counts: () => Promise.resolve({ delayed: 0, inFlight: 1, visible: 0 }),
    deleteBatch: () => Promise.resolve([]),
    receive: () => Promise.resolve([]),
  } satisfies QueueCleanupPort;
  await assert.rejects(
    drainQueueWithPort(port, {
      clock: manualClock(),
      deadlineMs: 50,
      pollIntervalMs: 10,
      stableEmptyMs: 20,
    }),
    (error: unknown) =>
      error instanceof QueueCleanupError && error.code === 'queue-not-empty-before-deadline',
  );
});
