import { expect, it, vi } from 'vitest';

import type { SandboxTelemetryEnabledInput } from '../types.js';
import { composeTelemetryController } from './compose-controller.js';

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
      readiness: { kind: 'http', path: '/ready', intervalSeconds: 1, timeoutSeconds: 1, retries: 1 },
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
  const participantStop = vi.fn(
    () => new Promise<void>((resolve) => releases.push(resolve)),
  );
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
  expect(participantStop).toHaveBeenNthCalledWith(1, {
    timeout: 6,
    remove: false,
    removeVolumes: false,
  });
  expect(collectorStop).toHaveBeenCalledWith({
    timeout: 2,
    remove: false,
    removeVolumes: false,
  });
});
