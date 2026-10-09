import { createClient } from 'redis';
import { defineClient } from '@suites/blackbox-playwright';

export const redis = defineClient(createClient, {
  target: { participant: 'redis', containerPort: 6379 },
  env: [] as const,
  create: (sdk, { endpoint }) => sdk({ url: `redis://${endpoint.host}:${endpoint.port}` }),
  ready: async (client) => {
    await client.connect();
    await client.ping();
  },
  dispose: (client) => client.disconnect(),
});
