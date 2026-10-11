import { defineClients } from '@suites/blackbox-playwright';

import { payments } from './payment-mock.js';
import { postgres } from './postgres.js';
import { api } from './public-api.js';
import { redis } from './redis.js';

export const subscriptionClients = defineClients({ api, redis, postgres });
export const paymentClients = defineClients({ payments });
