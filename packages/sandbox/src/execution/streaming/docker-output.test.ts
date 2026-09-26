import { once } from 'node:events';
import { PassThrough, Readable } from 'node:stream';

import { expect, it, vi } from 'vitest';

import { attachDockerOutput } from './docker-output.js';
import type { SandboxContainerTerminal } from './types.js';

async function exerciseBackpressure(terminal: SandboxContainerTerminal): Promise<void> {
  const stream = new PassThrough({ highWaterMark: 16 * 1024 });
  let unblock: () => void = () => undefined;
  const blocked = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  let deliveries = 0;
  let inFlight = 0;
  let maximumInFlight = 0;
  const output = attachDockerOutput({
    stream,
    request: {
      kind: 'container-stream-exec',
      service: 'api',
      argv: ['noisy'],
      environment: {},
      terminal,
      onOutput: async () => {
        deliveries += 1;
        inFlight += 1;
        maximumInFlight = Math.max(maximumInFlight, inFlight);
        await blocked;
        inFlight -= 1;
      },
    },
    demux: (input) => {
      input.stream.pipe(input.stdout);
    },
  });
  const ended = once(stream, 'end');
  Readable.from(Array.from({ length: 512 }, () => Buffer.alloc(16 * 1024, 120))).pipe(stream);

  await vi.waitFor(() => {
    expect(deliveries).toBe(1);
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(maximumInFlight).toBe(1);
  expect(deliveries).toBe(1);
  expect(stream.readableLength).toBeLessThanOrEqual(stream.readableHighWaterMark);

  unblock();
  await ended;
  await output.settled();
  expect(deliveries).toBeGreaterThan(1);
  expect(maximumInFlight).toBe(1);
}

it('bounds blocked Docker output delivery for captured and tty streams', async () => {
  await exerciseBackpressure({ kind: 'captured' });
  await exerciseBackpressure({ kind: 'tty', columns: 80, rows: 24 });
});
