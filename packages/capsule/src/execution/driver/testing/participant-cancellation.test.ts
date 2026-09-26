import { expect, it } from 'vitest';

import { runParticipantInteractive } from '../../participant/process.js';
import { driverSandbox } from './execution.fixture.js';

it('force-terminates a participant whose stdin write blocks cancellation', async () => {
  const cancellation = new AbortController();
  let enteredWrite: () => void = () => undefined;
  const writeStarted = new Promise<void>((resolve) => {
    enteredWrite = resolve;
  });
  let complete: () => void = () => undefined;
  const completion = new Promise<{
    readonly kind: 'exited';
    readonly service: string;
    readonly exitCode: number;
  }>((resolve) => {
    complete = () => {
      resolve({ kind: 'exited', service: 'api', exitCode: 137 });
    };
  });
  let forced = 0;
  const base = driverSandbox();
  const sandbox = {
    ...base,
    startContainerExecution: () =>
      Promise.resolve({
        kind: 'started' as const,
        execution: {
          completion,
          writeStdin: () => {
            enteredWrite();
            return new Promise<never>(() => undefined);
          },
          endStdin: () =>
            Promise.resolve({
              kind: 'delivered' as const,
              action: 'stdin-end' as const,
              mechanism: 'docker-stream' as const,
            }),
          resize: () => Promise.reject(new Error('unused')),
          signal: () => Promise.reject(new Error('unused')),
          forceTerminate: () => {
            forced += 1;
            complete();
            return Promise.resolve({
              kind: 'delivered' as const,
              action: 'signal' as const,
              mechanism: 'docker-stream-abort' as const,
            });
          },
        },
      }),
  };
  async function* controls() {
    await Promise.resolve();
    yield { kind: 'stdin-chunk' as const, controlId: 'blocked', chunk: Buffer.alloc(1024) };
  }

  const execution = runParticipantInteractive({
    sandbox,
    location: { kind: 'participant', participantId: 'api', service: 'api' },
    argv: ['cat'],
    environment: {},
    interaction: {
      kind: 'interactive',
      cancellation: { kind: 'abort-signal', signal: cancellation.signal },
      terminal: { columns: 80, rows: 24 },
      controls: controls(),
      onEvent: () => Promise.resolve(),
    },
    secrets: [],
  });
  const fallback = setTimeout(() => {
    complete();
  }, 500);
  await writeStarted;
  cancellation.abort();

  try {
    await expect(execution).resolves.toMatchObject({ kind: 'exited', exitCode: 137 });
    expect(forced).toBe(1);
  } finally {
    clearTimeout(fallback);
  }
});
