import { createClient } from 'redis';

import { requiredEnvironment } from './config.js';
import { writeError } from './log.js';

export async function createRedisConnection() {
  const client = createClient({ url: requiredEnvironment('REDIS_URL') });
  client.on('error', (error) => {
    writeError(new Error('redis connection error', { cause: error }));
  });
  await client.connect();
  return client;
}

export type RedisConnection = Awaited<ReturnType<typeof createRedisConnection>>;
