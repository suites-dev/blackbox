import { afterEach, expect, it } from 'vitest';

import type { CapsuleInteractiveEvent, CapsuleInteractiveControl } from '../types.js';
import { runCapsuleDriver } from '../driver-execution.js';
import {
  cleanDriverProjects,
  driverInput,
  driverProject,
  driverSandbox,
} from './testing/execution.fixture.js';

afterEach(cleanDriverProjects);

async function* controls(): AsyncGenerator<CapsuleInteractiveControl> {
  await Promise.resolve();
  yield { kind: 'stdin-end', controlId: 'done' };
}

it('masks declared values before interactive events leave the execution, across byte and chunk boundaries', async () => {
  const directory = await driverProject(`export default {
    kind: 'project-driver', name: 'http', prepare(request) {
      return { kind: 'prepared-command',
        argv: [...request.command.argv, request.target.environment.ARGV_SECRET],
        environment: { PRIVATE: request.target.environment.API_TOKEN },
        propagation: { kind: 'context-injected', format: 'w3c-trace-context', carrier: 'http-headers' },
        redaction: { kind: 'driver-redaction', requestArgv: { kind: 'none' },
          preparedArgv: { kind: 'positions', positions: [3] },
          environment: { kind: 'keys', keys: ['PRIVATE'] } } };
    }
  };`);
  const environmentSecret = '🔑private.[token]';
  const argvSecret = 'argv-private-token';
  const events: CapsuleInteractiveEvent[] = [];
  const result = await runCapsuleDriver({
    ...driverInput(directory),
    sandbox: driverSandbox({
      API_TOKEN: environmentSecret,
      ARGV_SECRET: argvSecret,
    }),
    argv: [
      process.execPath,
      '-e',
      `
      const value = Buffer.from(
        '🔑before:' + process.env.PRIVATE + '|' + process.argv[1] + ':after'
      );
      let index = 0;
      const timer = setInterval(() => {
        if (index === value.length) { clearInterval(timer); return; }
        process.stdout.write(value.subarray(index, index + 1));
        process.stderr.write(value.subarray(index, index + 1));
        index += 1;
      }, 2);
    `,
    ],
    interaction: {
      kind: 'interactive',
      cancellation: { kind: 'not-cancellable' },
      terminal: { columns: 80, rows: 24 },
      controls: controls(),
      onEvent: (event) => {
        events.push(event);
        return Promise.resolve();
      },
    },
  });
  for (const stream of ['stdout', 'stderr'] as const) {
    const output = Buffer.concat(
      events.flatMap((event) =>
        event.kind === 'output' && event.stream === stream ? [Buffer.from(event.chunk)] : [],
      ),
    ).toString('utf8');
    expect(output).toBe('🔑before:[REDACTED]|[REDACTED]:after');
  }
  expect(result).toMatchObject({
    kind: 'driver-completed',
    process: {
      argv: [process.execPath, '-e', expect.any(String), '[REDACTED]'],
      stdout: '🔑before:[REDACTED]|[REDACTED]:after',
      stderr: '🔑before:[REDACTED]|[REDACTED]:after',
    },
  });
  expect(JSON.stringify(result)).not.toContain(environmentSecret);
  expect(JSON.stringify(result)).not.toContain(argvSecret);
});
