import { expect, it, vi } from 'vitest';
import { defineClient, runClients } from './clients.js';
import type { ClientSandbox } from './types.js';

const sandbox = {
  containers: new Map([['api', { service: 'api', testcontainer: {
    id: 'container',
    name: 'container',
    labels: {},
    networkNames: [],
    mappedPorts: new Map([[3000, 1234]]),
    host: '127.0.0.1',
    environment: {},
    getMappedPort: () => 1234,
  } }]]),
} satisfies ClientSandbox;

it.each(['resolve', 'reject', 'hang'] as const)(
  'disposes creation after cleanup grace without delaying timeout when disposal will %s',
  async (settlement) => {
    vi.useFakeTimers();
    try {
      const client = { name: 'eventually-created' };
      let resolveCreation!: (value: typeof client) => void;
      const ready = vi.fn();
      const dispose = vi.fn(() => {
        if (settlement === 'reject') {return Promise.reject(new Error('late disposal failed'));}
        if (settlement === 'hang') {return new Promise<void>(() => undefined);}
        return Promise.resolve();
      });
      const definition = defineClient({}, {
        target: { participant: 'api', containerPort: 3000 },
        env: [] as const,
        create: () => new Promise<typeof client>((resolve) => { resolveCreation = resolve; }),
        ready,
        dispose,
      });
      const use = vi.fn(() => Promise.resolve());
      const failure = expect(runClients({ api: definition }, sandbox, use, {
        setupTimeoutMs: 10,
        cleanupTimeoutMs: 20,
      })).rejects.toThrow('late client could not be disposed');
      await vi.advanceTimersByTimeAsync(30);
      await failure;
      expect(dispose).not.toHaveBeenCalled();
      resolveCreation(client);
      await vi.advanceTimersByTimeAsync(0);
      expect(dispose).toHaveBeenCalledExactlyOnceWith(client);
      expect(use).not.toHaveBeenCalled();
      expect(ready).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(20);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  },
);

it('handles creation rejection after cleanup grace without disposing a nonexistent client', async () => {
  vi.useFakeTimers();
  try {
    let rejectCreation!: (error: Error) => void;
    const dispose = vi.fn();
    const definition = defineClient({}, {
      target: { participant: 'api', containerPort: 3000 },
      env: [] as const,
      create: () => new Promise<object>((_resolve, reject) => { rejectCreation = reject; }),
      ready: vi.fn(),
      dispose,
    });
    const failure = expect(runClients({ api: definition }, sandbox, () => Promise.resolve(), {
      setupTimeoutMs: 10,
      cleanupTimeoutMs: 20,
    })).rejects.toThrow('late client could not be disposed');
    await vi.advanceTimersByTimeAsync(30);
    await failure;
    rejectCreation(new Error('late creation failed'));
    await vi.advanceTimersByTimeAsync(0);
    expect(dispose).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
