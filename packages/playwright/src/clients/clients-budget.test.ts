import { expect, it, vi } from 'vitest';
import { remainingClientSetupMs } from './client-timeouts.js';
import { defineClient, runClients } from './clients.js';
import { clientSetupTimeoutMs } from '../fixtures.js';
import type { ClientSandbox } from './types.js';

const sandbox = {
  containers: new Map([
    [
      'api',
      {
        service: 'api',
        testcontainer: {
          id: 'container',
          name: 'container',
          labels: {},
          networkNames: [],
          mappedPorts: new Map([[3000, 1234]]),
          host: '127.0.0.1',
          environment: {},
          getMappedPort: () => 1234,
        },
      },
    ],
  ]),
} satisfies ClientSandbox;

it('uses the remaining native timeout without reserving extra setup time', () => {
  expect(remainingClientSetupMs(100, 0)).toBe(100);
  expect(remainingClientSetupMs(100, 20)).toBe(80);
  expect(remainingClientSetupMs(100, 99)).toBe(1);
  expect(remainingClientSetupMs(100, 120)).toBe(1);
  expect(remainingClientSetupMs(0, 120)).toBe(Number.POSITIVE_INFINITY);
});

it('converts the native timeout after elapsed fixture setup', () => {
  expect(clientSetupTimeoutMs({ timeout: 100 }, 900, 900)).toBe(100);
  expect(clientSetupTimeoutMs({ timeout: 100 }, 900, 920)).toBe(80);
  expect(clientSetupTimeoutMs({ timeout: 100 }, 900, 1_020)).toBe(1);
  expect(clientSetupTimeoutMs({ timeout: 0 }, 900, 1_020)).toBe(Number.POSITIVE_INFINITY);
});

it('allows asynchronous readiness inside a finite setup budget', async () => {
  vi.useFakeTimers();
  try {
    const events: string[] = [];
    const definition = defineClient(
      {},
      {
        target: { participant: 'api', containerPort: 3000 },
        env: [] as const,
        create: () => {
          events.push('create');
          return { name: 'api' };
        },
        ready: async () => {
          await new Promise<void>((resolve) => setTimeout(resolve, 20));
          events.push('ready');
        },
        dispose: () => {
          events.push('dispose');
        },
      },
    );
    const use = vi.fn(() => {
      events.push('use');
      return Promise.resolve();
    });
    const run = runClients({ api: definition }, sandbox, use, {
      cleanupTimeoutMs: 100,
      setupTimeoutMs: 100,
    });
    await vi.advanceTimersByTimeAsync(20);
    await expect(run).resolves.toBeUndefined();
    expect(use).toHaveBeenCalledOnce();
    expect(events).toEqual(['create', 'ready', 'use', 'dispose']);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
