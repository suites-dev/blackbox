import { expect, it, vi } from 'vitest';

import type { SandboxTelemetryEnabledInput } from '../types.js';
import { composeTelemetryController, stopGrace } from './compose-controller.js';

function telemetry(): SandboxTelemetryEnabledInput {
  return {
    kind: 'enabled',
    sessionId: 'session-1',
    executionId: 'execution-1',
    authorization: {
      kind: 'split-bearer-tokens',
      ingestToken: 'ingest-secret',
      controlToken: 'control-secret',
    },
    collector: {
      service: 'collector',
      containerPort: 4318,
      runtime: { kind: 'image-default', image: 'collector:test' },
      environment: {},
      readiness: {
        kind: 'http',
        path: '/ready',
        intervalSeconds: 1,
        timeoutSeconds: 1,
        retries: 1,
      },
      drain: { kind: 'signal', signal: 'SIGTERM' },
    },
    participants: [
      {
        service: 'api',
        runtime: 'node',
        environment: {},
        activation: { kind: 'none' },
        mounts: [],
      },
      {
        service: 'worker',
        runtime: 'node',
        environment: {},
        activation: { kind: 'none' },
        mounts: [],
      },
    ],
  };
}

it('stops participants concurrently and reserves the final deadline for the collector', async () => {
  const releases: (() => void)[] = [];
  const participantStop = vi.fn(() => new Promise<void>((resolve) => releases.push(resolve)));
  const collectorStop = vi.fn(() => Promise.resolve());
  const started = {
    getContainer(name: string) {
      return {
        getHost: () => '127.0.0.1',
        getMappedPort: () => 4318,
        stop: name === 'collector-1' ? collectorStop : participantStop,
      };
    },
  };
  const controller = composeTelemetryController({ started, telemetry: telemetry() });
  const stopping = controller.prepareStop({ timeoutMs: 8_000 });
  await vi.waitFor(() => {
    expect(participantStop).toHaveBeenCalledTimes(2);
  });
  expect(collectorStop).not.toHaveBeenCalled();
  releases.forEach((release) => {
    release();
  });
  await stopping;
  // testcontainers StopOptions.timeout is in milliseconds: 4 s and 2 s of grace,
  // with 2 s of the 8 s budget left in reserve.
  expect(participantStop).toHaveBeenNthCalledWith(1, {
    timeout: 4_000,
    remove: false,
    removeVolumes: false,
  });
  expect(collectorStop).toHaveBeenCalledWith({
    timeout: 2_000,
    remove: false,
    removeVolumes: false,
  });
});

it('stop grace always leaves a reserve under the caller deadline', () => {
  for (const timeoutMs of [1, 500, 999, 1_000, 1_999, 2_000, 8_000, 30_000, 60_000, 600_000]) {
    const { participantMs, collectorMs } = stopGrace(timeoutMs);
    expect(participantMs + collectorMs, String(timeoutMs)).toBeLessThanOrEqual(timeoutMs);
    expect(participantMs).toBeLessThanOrEqual(10_000);
    if (timeoutMs >= 4_000) {
      expect(participantMs + collectorMs).toBeLessThanOrEqual(timeoutMs * 0.75);
      expect(collectorMs).toBeGreaterThanOrEqual(1_000);
    }
  }
  // A budget under two seconds leaves no grace instead of exceeding the budget.
  expect(stopGrace(999)).toEqual({ participantMs: 0, collectorMs: 0 });
  expect(stopGrace(2_000)).toEqual({ participantMs: 0, collectorMs: 1_000 });
  // The capsule stop budget: a participant that ignores SIGTERM costs at most 10 s.
  expect(stopGrace(60_000)).toEqual({ participantMs: 10_000, collectorMs: 15_000 });
});
