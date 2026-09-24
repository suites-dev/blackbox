import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type {
  ComposeSandboxDriver,
  SandboxInput,
  SandboxTelemetryStatus,
  StartedComposeSandbox,
} from '../types.js';
import {
  deterministicClock,
  sandboxFixture,
  silentStart,
  startedSandbox,
} from '../lifecycle/runtime.fixture.js';
import { SandboxRuntime } from '../lifecycle/runtime.js';

async function enabledInput(): Promise<SandboxInput> {
  const fixture = await sandboxFixture();
  const bundle = join(fixture.root, 'instrumentation.js');
  await writeFile(bundle, 'export {}\n');
  return {
    ...fixture.input,
    telemetry: {
      kind: 'enabled',
      sessionId: 'session-01',
      executionId: 'execution-01',
      authorization: { kind: 'bearer-token', token: 'secret' },
      collector: {
        service: 'blackbox-collector',
        image: 'collector:test',
        containerPort: 4318,
        command: { kind: 'image-default' },
        environment: {},
        readiness: {
          kind: 'http',
          path: '/ready',
          intervalSeconds: 1,
          timeoutSeconds: 1,
          retries: 5,
        },
        drain: { kind: 'signal', signal: 'SIGTERM' },
      },
      participants: [
        {
          service: 'orders',
          runtime: 'node',
          environment: {},
          mounts: [{ source: bundle, target: '/bundle.js', access: 'read-only' }],
        },
      ],
    },
  };
}

function telemetryCompose(input: {
  readonly inspect: () => Promise<SandboxTelemetryStatus>;
  readonly prepareStop: () => Promise<void>;
  readonly stop: () => Promise<void>;
}): StartedComposeSandbox {
  return {
    ...startedSandbox({ stop: input.stop }),
    inspectTelemetry: input.inspect,
    prepareStop: input.prepareStop,
  };
}

it('refuses acquisition when the required collector is unavailable', async () => {
  const input = await enabledInput();
  const stop = vi.fn(() => Promise.resolve());
  const driver = {
    start: () =>
      Promise.resolve(
        telemetryCompose({
          inspect: () =>
            Promise.resolve({
              kind: 'unavailable',
              endpoints: {
                baseUrl: 'http://127.0.0.1:4318',
                tracesUrl: 'http://127.0.0.1:4318/v1/traces',
                activationUrl: 'http://127.0.0.1:4318/v1/activation',
                readUrl: 'http://127.0.0.1:4318/status',
              },
              error: { name: 'Error', message: 'connection refused' },
            }),
          prepareStop: () => Promise.resolve(),
          stop,
        }),
      ),
  } satisfies ComposeSandboxDriver;
  await expect(
    new SandboxRuntime({ driver, now: deterministicClock(), onEvent: () => undefined }).start(
      silentStart(input),
    ),
  ).rejects.toMatchObject({ name: 'SandboxStartError' });
  expect(stop).toHaveBeenCalledOnce();
});

it('reports runtime collector loss and drains applications before Compose cleanup', async () => {
  const input = await enabledInput();
  const order: string[] = [];
  let probe = 0;
  const compose = telemetryCompose({
    inspect: () => {
      probe += 1;
      return Promise.resolve(
        probe === 1
          ? {
              kind: 'available',
              endpoints: {
                baseUrl: 'http://127.0.0.1:4318',
                tracesUrl: 'http://127.0.0.1:4318/v1/traces',
                activationUrl: 'http://127.0.0.1:4318/v1/activation',
                readUrl: 'http://127.0.0.1:4318/status',
              },
            }
          : {
              kind: 'unavailable',
              endpoints: {
                baseUrl: 'http://127.0.0.1:4318',
                tracesUrl: 'http://127.0.0.1:4318/v1/traces',
                activationUrl: 'http://127.0.0.1:4318/v1/activation',
                readUrl: 'http://127.0.0.1:4318/status',
              },
              error: { name: 'Error', message: 'collector exited' },
            },
      );
    },
    prepareStop: () => {
      order.push('applications-and-collector');
      return Promise.resolve();
    },
    stop: () => {
      order.push('compose-down');
      return Promise.resolve();
    },
  });
  const driver = { start: () => Promise.resolve(compose) } satisfies ComposeSandboxDriver;
  const handle = await new SandboxRuntime({
    driver,
    now: deterministicClock(),
    onEvent: () => undefined,
  }).start(silentStart(input));
  await expect(handle.inspectTelemetry()).resolves.toMatchObject({ kind: 'unavailable' });
  expect(handle.state).toBe('running');
  await handle.stop({ reason: 'completed' });
  expect(order).toEqual(['applications-and-collector', 'compose-down']);
});
