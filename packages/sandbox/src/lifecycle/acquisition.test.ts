import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readSandboxRecord } from '../ownership/records.js';
import type { ComposeSandboxDriver, ComposeStartRequest, SandboxHandle } from '../types.js';
import { SandboxStartError } from './errors.js';
import {
  deterministicClock,
  sandboxFixture,
  silentStart,
  startedSandbox,
} from './runtime.fixture.js';
import { SandboxRuntime } from './runtime.js';

function expectReadonlyInspection(handle: SandboxHandle): void {
  const inspection = handle.getContainer({ service: 'orders' }).testcontainer;
  expect(inspection.mappedPorts.get(3000)).toBe(13_000);
  expect(handle.declaredEnvironment).toEqual({ MODE: 'test' });
  for (const mutator of ['stop', 'restart', 'exec', 'copyArchiveFromContainer']) {
    expect(mutator in inspection).toBe(false);
  }
  expect('set' in handle.containers).toBe(false);
  expect('set' in handle.endpoints).toBe(false);
  expect('set' in inspection.mappedPorts).toBe(false);
  expect(Object.isFrozen(handle.declaredEnvironment)).toBe(true);
  expect(Object.isFrozen(inspection.labels)).toBe(true);
  expect(Object.isFrozen(inspection.networkNames)).toBe(true);
}

it('admits before Docker, forwards inputs, and exposes readonly inspection', async () => {
  const { input } = await sandboxFixture();
  let request: ComposeStartRequest | null = null;
  const driver = {
    async start(value) {
      const admitted = await readSandboxRecord({
        recordDirectory: input.recordDirectory,
        sandboxId: input.sandboxId,
      });
      expect(admitted.state).toBe('starting');
      request = value;
      return startedSandbox({ stop: () => Promise.resolve() });
    },
  } satisfies ComposeSandboxDriver;
  const events: string[] = [];
  const handle = await new SandboxRuntime({
    driver,
    now: deterministicClock(),
    onEvent: (event) => events.push(event.state),
  }).start(silentStart(input));
  expect(request).toMatchObject({
    projectDirectory: input.projectDirectory,
    composeFiles: input.composeFiles,
    environment: input.environment,
    serviceSelection: input.serviceSelection,
    startupTimeoutMs: input.startupTimeoutMs,
  });
  expect(handle.endpoints.get('http')).toEqual({
    name: 'http',
    service: 'orders',
    containerPort: 3000,
    host: '127.0.0.1',
    port: 13_000,
  });
  expect(handle.getContainer({ service: 'orders' })).toMatchObject({
    service: 'orders',
    testcontainer: { id: 'container-id', networkNames: ['orders_default'] },
  });
  expectReadonlyInspection(handle);
  expect(
    (
      await readSandboxRecord({
        recordDirectory: input.recordDirectory,
        sandboxId: input.sandboxId,
      })
    ).state,
  ).toBe('running');
  expect(events).toEqual(['admitted', 'starting', 'running']);
});

it('retains startup and cleanup failures separately', async () => {
  const { input } = await sandboxFixture();
  const cleanupFailure = new Error('compose down failed');
  const compose = startedSandbox({ stop: () => Promise.reject(cleanupFailure) });
  const driver = {
    start: () =>
      Promise.resolve({
        ...compose,
        getContainer: () => {
          throw new Error('mapped endpoint missing');
        },
      }),
  } satisfies ComposeSandboxDriver;
  let thrown: unknown;
  try {
    await new SandboxRuntime({ driver, now: deterministicClock(), onEvent: () => undefined }).start(
      silentStart(input),
    );
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(SandboxStartError);
  if (!(thrown instanceof SandboxStartError)) {
    throw new Error('Expected SandboxStartError');
  }
  expect(thrown.failure).toMatchObject({
    kind: 'start-failed',
    startupError: { message: 'mapped endpoint missing' },
    cleanup: { kind: 'failed', error: cleanupFailure },
    record: { kind: 'written' },
  });
  expect(
    await readSandboxRecord({ recordDirectory: input.recordDirectory, sandboxId: input.sandboxId }),
  ).toMatchObject({
    state: 'start-failed',
    primaryError: { message: 'mapped endpoint missing' },
    cleanup: { kind: 'failed', error: { message: 'compose down failed' } },
  });
});

it('leaves failed driver startup visible without fabricating cleanup success', async () => {
  const { input } = await sandboxFixture();
  const driver = {
    start: () => Promise.reject(new Error('compose up failed')),
  } satisfies ComposeSandboxDriver;
  await expect(
    new SandboxRuntime({ driver, now: deterministicClock(), onEvent: () => undefined }).start(
      silentStart(input),
    ),
  ).rejects.toMatchObject({
    name: 'SandboxStartError',
    failure: { kind: 'start-failed', cleanup: { kind: 'not-attempted' } },
  });
  expect(
    await readSandboxRecord({ recordDirectory: input.recordDirectory, sandboxId: input.sandboxId }),
  ).toMatchObject({
    state: 'start-failed',
    primaryError: { message: 'compose up failed' },
    cleanup: { kind: 'not-attempted' },
  });
});

it('does not overwrite an existing sandbox identity', async () => {
  const { input } = await sandboxFixture();
  const driver = {
    start: () => Promise.resolve(startedSandbox({ stop: () => Promise.resolve() })),
  } satisfies ComposeSandboxDriver;
  const runtime = new SandboxRuntime({
    driver,
    now: deterministicClock(),
    onEvent: () => undefined,
  });
  const handle = await runtime.start(silentStart(input));
  await expect(runtime.start(silentStart(input))).rejects.toMatchObject({ code: 'EEXIST' });
  await handle.stop({ reason: 'completed' });
  const bytes = await readFile(join(input.recordDirectory, `${input.sandboxId}.json`), 'utf8');
  expect(JSON.parse(bytes)).toMatchObject({ state: 'completed' });
});
