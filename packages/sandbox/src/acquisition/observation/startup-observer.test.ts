import { expect, it, vi } from 'vitest';
import type {
  ComposeAcquisitionObservation,
  ComposeObservationSnapshot,
  ComposeServiceObservation,
} from '../observation.js';
import { observeComposeStartup } from './startup-observer.js';

const running = {
  service: 'api',
  containerId: 'api-id',
  containerName: 'owned-api-1',
  state: 'running',
  health: 'starting',
  termination: { kind: 'none' },
} satisfies ComposeServiceObservation;
const snapshot = {
  containers: [running],
  resources: [{ kind: 'network', name: 'owned-default' }],
} satisfies ComposeObservationSnapshot;

it('reports real state before completion, deduplicates, and keeps health separate from readiness', async () => {
  const events: ComposeAcquisitionObservation[] = [];
  const inspect = vi.fn().mockResolvedValue(snapshot);
  let now = 0;
  const observer = observeComposeStartup({
    mode: { kind: 'events', emit: (event) => events.push(event) },
    inspect,
    now: () => now,
    intervalMs: 1,
  });
  try {
    await vi.waitFor(() => {
      expect(events).toHaveLength(3);
    });
    expect(events).toEqual([
      { kind: 'service-state', container: running },
      { kind: 'resource-discovered', resource: { kind: 'network', name: 'owned-default' } },
      { kind: 'waiting', elapsedMs: 0 },
    ]);
    inspect.mockResolvedValue({
      containers: [{ ...running, health: 'healthy' }],
      resources: snapshot.resources,
    });
    await vi.waitFor(() => {
      expect(events.at(-1)).toMatchObject({
        kind: 'service-state',
        container: { state: 'running', health: 'healthy' },
      });
    });
    expect(JSON.stringify(events)).not.toContain('ready');
    now = 5000;
    await vi.waitFor(() => {
      expect(events.at(-1)).toEqual({ kind: 'waiting', elapsedMs: 5000 });
    });
  } finally {
    await observer.stop();
  }
  const count = events.length;
  const inspections = inspect.mock.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(events).toHaveLength(count);
  expect(inspect).toHaveBeenCalledTimes(inspections);
});

it('aborts an in-flight inspection on failed acquisition without publishing unavailable after stop', async () => {
  let observedSignal: AbortSignal | undefined;
  const events: ComposeAcquisitionObservation[] = [];
  const observer = observeComposeStartup({
    mode: { kind: 'events', emit: (event) => events.push(event) },
    now: Date.now,
    intervalMs: 500,
    inspect: ({ signal }) =>
      new Promise((_resolve, reject) => {
        observedSignal = signal;
        signal.addEventListener(
          'abort',
          () => {
            reject(new Error('aborted'));
          },
          { once: true },
        );
      }),
  });
  await observer.stop();
  expect(observedSignal).toBeDefined();
  expect(observedSignal!.aborted).toBe(true);
  expect(events).toEqual([]);
});

it('records unavailable and recovered observation without converting Docker errors into acquisition failures', async () => {
  const events: ComposeAcquisitionObservation[] = [];
  const inspect = vi.fn().mockRejectedValue(new Error('private daemon details'));
  const observer = observeComposeStartup({
    mode: { kind: 'events', emit: (event) => events.push(event) },
    inspect,
    now: Date.now,
    intervalMs: 1,
  });
  try {
    await vi.waitFor(() => {
      expect(events).toHaveLength(2);
    });
    expect(events.filter((event) => event.kind === 'observation-status')).toEqual([
      { kind: 'observation-status', status: 'unavailable' },
    ]);
    inspect.mockResolvedValue({
      containers: [{ ...running, state: 'exited', termination: { kind: 'exited', exitCode: 9 } }],
      resources: [],
    });
    await vi.waitFor(() => {
      expect(events).toContainEqual({ kind: 'observation-status', status: 'available' });
    });
    expect(events.at(-1)).toMatchObject({
      kind: 'service-state',
      container: { state: 'exited', termination: { exitCode: 9 } },
    });
    expect(JSON.stringify(events)).not.toContain('private');
  } finally {
    await observer.stop();
  }
});

it('does not inspect in silent mode, and contains presentation exceptions in events mode', async () => {
  const inspect = vi.fn().mockResolvedValue(snapshot);
  await observeComposeStartup({
    mode: { kind: 'silent' },
    inspect,
    now: Date.now,
    intervalMs: 500,
  }).stop();
  expect(inspect).not.toHaveBeenCalled();
  const observer = observeComposeStartup({
    mode: {
      kind: 'events',
      emit: () => {
        throw new Error('terminal gone');
      },
    },
    inspect,
    now: Date.now,
    intervalMs: 1,
  });
  await Promise.resolve();
  await observer.stop();
  expect(inspect).toHaveBeenCalledOnce();
});
