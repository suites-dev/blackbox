import pg from 'pg';
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
  dispose: (client) => (client.isOpen ? client.quit() : Promise.resolve()),
});
export const postgres = defineClient(pg.Pool, {
  target: { participant: 'postgres', containerPort: 5432 },
  env: [] as const,
  create: (Pool, { endpoint }) =>
    new Pool({
      host: endpoint.host,
      port: endpoint.port,
      user: 'acceptance',
      password: 'acceptance',
      database: 'acceptance',
    }),
  ready: (client) => client.query('SELECT 1'),
  dispose: (client) => client.end(),
});
