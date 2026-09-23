import { rm, writeFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import type { ComposeSandboxDriver } from '../types.js';
import {
  deterministicClock,
  sandboxFixture,
  silentStart,
  startedSandbox,
} from './runtime.fixture.js';
import { SandboxRuntime } from './runtime.js';

async function blockRecordDirectory(recordDirectory: string): Promise<void> {
  await rm(recordDirectory, { recursive: true });
  await writeFile(recordDirectory, 'not a directory');
}

it('preserves a startup error when its terminal record cannot be written', async () => {
  const { input } = await sandboxFixture();
  const driver = {
    async start() {
      await blockRecordDirectory(input.recordDirectory);
      throw new Error('compose up failed');
    },
  } satisfies ComposeSandboxDriver;
  await expect(
    new SandboxRuntime({ driver, now: deterministicClock(), onEvent: () => undefined }).start(
      silentStart(input),
    ),
  ).rejects.toMatchObject({
    failure: {
      kind: 'start-failed',
      startupError: { message: 'compose up failed' },
      record: { kind: 'failed' },
    },
  });
});

it('surfaces a terminal-record failure after successful cleanup', async () => {
  const { input } = await sandboxFixture();
  const driver = {
    start: () => Promise.resolve(startedSandbox({ stop: () => Promise.resolve() })),
  } satisfies ComposeSandboxDriver;
  const handle = await new SandboxRuntime({
    driver,
    now: deterministicClock(),
    onEvent: () => undefined,
  }).start(silentStart(input));
  await blockRecordDirectory(input.recordDirectory);
  await expect(handle.stop({ reason: 'completed' })).rejects.toMatchObject({
    failure: { kind: 'record-failed' },
  });
});

it('preserves cleanup and record failures as separate facts', async () => {
  const { input } = await sandboxFixture();
  const driver = {
    start: () =>
      Promise.resolve(
        startedSandbox({ stop: () => Promise.reject(new Error('compose down failed')) }),
      ),
  } satisfies ComposeSandboxDriver;
  const handle = await new SandboxRuntime({
    driver,
    now: deterministicClock(),
    onEvent: () => undefined,
  }).start(silentStart(input));
  await blockRecordDirectory(input.recordDirectory);
  await expect(handle.stop({ reason: 'failed' })).rejects.toMatchObject({
    failure: {
      kind: 'cleanup-failed',
      cleanupError: { message: 'compose down failed' },
      record: { kind: 'failed' },
    },
  });
});
