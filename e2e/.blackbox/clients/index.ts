import type { RegisteredClients } from '@suites/blackbox-playwright';

import type { payments } from './payment-mock.js';
import type { postgres } from './postgres.js';
import type { api } from './public-api.js';
import type { redis } from './redis.js';

export { api } from './public-api.js';
export { payments } from './payment-mock.js';
export { postgres } from './postgres.js';
export { redis } from './redis.js';

type ProjectClients = RegisteredClients<{
  api: typeof api;
  payments: typeof payments;
  postgres: typeof postgres;
  redis: typeof redis;
}>;

declare module '@suites/blackbox-playwright' {
  interface BlackboxClients {
    api: ProjectClients['api'];
    payments: ProjectClients['payments'];
    postgres: ProjectClients['postgres'];
    redis: ProjectClients['redis'];
  }
}
