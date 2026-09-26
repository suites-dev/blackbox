import assert from 'node:assert/strict';
import test from 'node:test';

import { RedisProofConsumer, type RedisProofSource } from './consumer.js';

function sourceWithOneProof(proofId: string): {
  readonly source: RedisProofSource;
  readonly blocked: Promise<void>;
} {
  let takeCount = 0;
  let releaseBlocked = (): void => undefined;
  const blocked = new Promise<void>((resolve) => {
    releaseBlocked = resolve;
  });
  return {
    blocked,
    source: {
      async take() {
        takeCount += 1;
        if (takeCount === 1) {
          return proofId;
        }
        await blocked;
        throw new Error('proof source closed');
      },
      async close() {
        releaseBlocked();
      },
    },
  };
}

void test('blocks without polling and delivers each Redis proof once', async () => {
  const fixture = sourceWithOneProof('shared-state-42');
  const delivered: string[] = [];
  let acknowledge = (): void => undefined;
  const acknowledged = new Promise<void>((resolve) => {
    acknowledge = resolve;
  });
  const consumer = new RedisProofConsumer({
    source: fixture.source,
    sink: {
      async deliver(proofId) {
        delivered.push(proofId);
        acknowledge();
      },
    },
  });

  const running = consumer.run();
  await acknowledged;
  await consumer.stop();
  await running;

  assert.deepEqual(delivered, ['shared-state-42']);
});

void test('closes the blocking source when downstream delivery fails', async () => {
  let closeCount = 0;
  const consumer = new RedisProofConsumer({
    source: {
      async take() {
        return 'shared-state-43';
      },
      async close() {
        closeCount += 1;
      },
    },
    sink: {
      async deliver() {
        throw new Error('public API unavailable');
      },
    },
  });

  await assert.rejects(consumer.run(), /public API unavailable/u);
  assert.equal(closeCount, 1);
});
