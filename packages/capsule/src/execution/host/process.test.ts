import { tmpdir } from 'node:os';

import { expect, it, vi } from 'vitest';

import type { CapsuleInteractiveControl } from '../types.js';
import { runHostWithInteraction } from './process.js';

async function* noControls(): AsyncGenerator<CapsuleInteractiveControl> {
  await Promise.resolve();
  yield* [];
}

it('pauses a noisy host child while interactive output delivery is blocked', async () => {
  let unblock: () => void = () => undefined;
  const blocked = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  let deliveries = 0;
  let inFlight = 0;
  let maximumInFlight = 0;
  let completed = false;
  const execution = runHostWithInteraction({
    argv: [
      process.execPath,
      '-e',
      `
      const chunk = Buffer.alloc(65536, 120); let remaining = 256;
      const write = () => {
        while (remaining-- > 0) if (!process.stdout.write(chunk)) {
          process.stdout.once('drain', write); return;
        }
      };
      write();
    `,
    ],
    cwd: tmpdir(),
    environment: {},
    interaction: {
      kind: 'interactive',
      cancellation: { kind: 'not-cancellable' },
      terminal: { columns: 80, rows: 24 },
      controls: noControls(),
      onEvent: async (event) => {
        if (event.kind !== 'output') {
          return;
        }
        deliveries += 1;
        inFlight += 1;
        maximumInFlight = Math.max(maximumInFlight, inFlight);
        await blocked;
        inFlight -= 1;
      },
    },
  });
  void execution.finally(() => {
    completed = true;
  });
  await vi.waitFor(() => {
    expect(deliveries).toBe(1);
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect({ deliveries, maximumInFlight, completed }).toEqual({
    deliveries: 1,
    maximumInFlight: 1,
    completed: false,
  });
  unblock();
  await expect(execution).resolves.toMatchObject({
    kind: 'exited',
    exitCode: 0,
    retention: { stdout: { kind: 'truncated' } },
  });
});
