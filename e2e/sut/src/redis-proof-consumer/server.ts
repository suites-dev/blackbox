import { createClient } from 'redis';

import { requiredEnvironment } from '../lib/config.js';
import { writeError } from '../lib/log.js';
import { retry } from '../lib/retry.js';
import { RedisProofConsumer, redisProofList, type RedisProofSource } from './consumer.js';

function createProofSource(client: ReturnType<typeof createClient>): RedisProofSource {
  let closeState = { kind: 'open' } as { readonly kind: 'open' } | { readonly kind: 'closed' };
  return {
    async take() {
      const result = await client.blPop(redisProofList, 0);
      if (result === null) {
        throw new Error('Redis proof list returned no item');
      }
      return result.element;
    },
    async close() {
      if (closeState.kind === 'closed') {
        return;
      }
      closeState = { kind: 'closed' };
      await client.disconnect();
    },
  };
}

async function main(): Promise<void> {
  const fixtureToken = requiredEnvironment('FIXTURE_CONTROL_TOKEN');
  const client = createClient({ url: requiredEnvironment('REDIS_URL') });
  client.on('error', (error) =>
    writeError(new Error('Redis proof consumer error', { cause: error })),
  );
  await retry('redis proof source', () => client.connect());
  const consumer = new RedisProofConsumer({
    source: createProofSource(client),
    sink: {
      async deliver(proofId) {
        const path = `/fixture/shared-state-proof/${encodeURIComponent(proofId)}`;
        const response = await fetch(`http://public-api:3000${path}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${fixtureToken}` },
        });
        await response.arrayBuffer();
        if (!response.ok) {
          throw new Error(`Shared-state proof endpoint returned HTTP ${String(response.status)}`);
        }
      },
    },
  });
  const shutdown = (): void => {
    void consumer.stop().catch(writeError);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  await consumer.run();
}

void main().catch((error: unknown) => {
  writeError(error);
  process.exitCode = 1;
});
