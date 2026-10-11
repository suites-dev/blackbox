import { setTimeout as delay } from 'node:timers/promises';
import { expect } from '@playwright/test';
import { defineClient } from '../../../clients/clients.js';
import { events, scenario } from './state.js';

const failReadiness = scenario === 'client-readiness-failure';
export const api = defineClient(
  {},
  {
    target: { participant: 'api', containerPort: 3000 },
    env: ['TOKEN'] as const,
    create: async (_sdk, { endpoint, env }) => {
      expect(env.TOKEN).toBe('secret');
      if (scenario === 'client-create-late') {
        events.push('create:start');
        await delay(400);
        events.push('create:finish');
      } else {
        events.push('create');
      }
      return { url: endpoint.url };
    },
    ready: () => {
      events.push('ready');
      if (scenario === 'client-readiness-timeout') {
        return new Promise<void>(() => undefined);
      }
      if (scenario === 'client-healthy-short-timeout') {
        return delay(20);
      }
      if (failReadiness) {
        throw new Error('client readiness deliberately failed');
      }
      return undefined;
    },
    dispose: () => {
      if (scenario === 'client-readiness-timeout' || scenario === 'client-create-late') {
        events.push('dispose:start');
        const disposal = scenario === 'client-readiness-timeout' ? delay(400) : Promise.resolve();
        return disposal.then(() => {
          events.push('dispose:finish');
        });
      }
      events.push('dispose');
      return undefined;
    },
  },
);
