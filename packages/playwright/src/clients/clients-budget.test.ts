import { expect, it, vi } from 'vitest';
import { defineClient, runClients } from './clients.js';
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
