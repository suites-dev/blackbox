import { expect, it } from 'vitest';

import { defineClient } from './clients.js';
import { defineClients } from './registry.js';

it('captures client registration names without mutating the source registry', () => {
  const redis = defineClient(
    {},
    {
      target: { participant: 'redis', containerPort: 6379 },
      env: [],
      create: () => ({ get: (key: string) => Promise.resolve(key) }),
      ready: () => undefined,
      dispose: () => undefined,
    },
  );
  const source = { redis };
  const registered = defineClients(source);
  expect(registered).toEqual({ redis });
  expect(registered.redis).toBe(redis);
  expect(Object.isFrozen(registered)).toBe(true);
  expect(Object.isFrozen(source)).toBe(false);
  source.redis = { ...redis };
  expect(registered.redis).toBe(redis);
});
