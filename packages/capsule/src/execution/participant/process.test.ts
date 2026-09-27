import type { SandboxContainerExecutionInput } from '@suites/blackbox-sandbox-internal';
import { expect, it } from 'vitest';

import { driverSandbox } from '../driver/testing/execution.fixture.js';
import { runParticipantCaptured } from './process.js';

it('runs captured participant commands with stdin closed instead of half-closing it', async () => {
  const requests: SandboxContainerExecutionInput[] = [];
  let endStdinCalls = 0;
  const base = driverSandbox();
  const sandbox = {
    ...base,
    startContainerExecution: async (request: SandboxContainerExecutionInput) => {
      requests.push(request);
      await request.onOutput({ kind: 'stdout', chunk: Buffer.from('1 row') });
      return {
        kind: 'started' as const,
        execution: {
          completion: Promise.resolve({
            kind: 'exited' as const,
            service: request.service,
            exitCode: 0,
          }),
          writeStdin: () => Promise.reject(new Error('unused')),
          endStdin: () => {
            endStdinCalls += 1;
            return Promise.reject(new Error('captured runs must not half-close stdin'));
          },
          resize: () => Promise.reject(new Error('unused')),
          signal: () => Promise.reject(new Error('unused')),
          forceTerminate: () => Promise.reject(new Error('unused')),
        },
      };
    },
  };
  async function* controls() {
    await Promise.resolve();
    yield* [];
  }

  await expect(
    runParticipantCaptured({
      sandbox,
      location: { kind: 'participant', participantId: 'postgres', service: 'postgres' },
      argv: ['psql', '-c', 'select 1'],
      environment: {},
      interaction: {
        kind: 'captured',
        cancellation: { kind: 'not-cancellable' },
        controls: controls(),
      },
      secrets: [],
    }),
  ).resolves.toMatchObject({ kind: 'exited', exitCode: 0, stdout: '1 row' });
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ terminal: { kind: 'captured' }, stdin: 'closed' });
  expect(endStdinCalls).toBe(0);
});
