import { Pool } from 'pg';
import { defineClient } from '@suites/blackbox-playwright';

export const postgres = defineClient(Pool, {
  target: { participant: 'postgres', containerPort: 5432 },
  env: ['POSTGRES_DB', 'POSTGRES_PASSWORD', 'POSTGRES_USER'] as const,
  create: (Client, { endpoint, env }) =>
    new Client({
      host: endpoint.host,
      port: endpoint.port,
      database: env.POSTGRES_DB,
      password: env.POSTGRES_PASSWORD,
      user: env.POSTGRES_USER,
    }),
  ready: async (client) => {
    await client.query('SELECT 1');
  },
  dispose: (client) => client.end(),
});
