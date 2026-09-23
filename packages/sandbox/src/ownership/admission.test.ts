import { expect, it } from 'vitest';
import type { ComposeSandboxDriver, SandboxHandle } from '../types.js';
import {
  deterministicClock,
  sandboxFixture,
  silentStart,
  startedSandbox,
} from '../lifecycle/runtime.fixture.js';
import { SandboxRuntime } from '../lifecycle/runtime.js';

it('admits exactly one concurrent owner for a sandbox identity', async () => {
  const { input } = await sandboxFixture();
  const driver = {
    start: () => Promise.resolve(startedSandbox({ stop: () => Promise.resolve() })),
  } satisfies ComposeSandboxDriver;
  const runtime = new SandboxRuntime({
    driver,
    now: deterministicClock(),
    onEvent: () => undefined,
  });
  const results = await Promise.allSettled([
    runtime.start(silentStart(input)),
    runtime.start(silentStart(input)),
  ]);
  const fulfilled = results.filter(
    (result): result is PromiseFulfilledResult<SandboxHandle> => result.status === 'fulfilled',
  );
  const rejected = results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  const [winner] = fulfilled;
  const [loser] = rejected;
  expect(winner).toBeDefined();
  expect(loser).toBeDefined();
  expect(loser.reason).toMatchObject({ code: 'EEXIST' });
  await winner.value.stop({ reason: 'completed' });
});
