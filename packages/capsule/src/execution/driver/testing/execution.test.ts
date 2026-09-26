import type { ResolvedCatalogDriver } from '@suites/blackbox-catalog-internal';
import type {
  SandboxContainerExecutionInput,
  SandboxHandle,
} from '@suites/blackbox-sandbox-internal';
import { afterEach, expect, it } from 'vitest';

import { runCapsuleDriver } from '../../driver-execution.js';
import {
  cleanDriverProjects,
  driverInput,
  driverProject,
  driverSandbox,
  httpDriver,
} from './execution.fixture.js';
import type { CapsuleInteractiveControl, CapsuleInteractiveEvent } from '../../types.js';

function participantSandbox(observed: {
  readonly requests: SandboxContainerExecutionInput[];
  readonly controls: string[];
}): SandboxHandle {
  const base = driverSandbox();
  const testcontainer = Object.freeze({
    id: 'postgres-container',
    name: 'postgres-1',
    host: '127.0.0.1',
    labels: Object.freeze({}),
    environment: Object.freeze({ POSTGRES_DB: 'app' }),
    networkNames: Object.freeze(['project_default']),
    mappedPorts: new Map<number, number>(),
    getMappedPort: () => 5432,
  });
  const container = Object.freeze({ service: 'postgres', testcontainer });
  return {
    ...base,
    containers: new Map([...base.containers, ['postgres', container]]),
    getContainer: ({ service }) =>
      service === 'postgres' ? container : base.getContainer({ service }),
    startContainerExecution: async (request) => {
      observed.requests.push(request);
      await request.onOutput({ kind: 'terminal-output', chunk: Buffer.from('participant-live') });
      let finish: () => void = () => undefined;
      const completion = new Promise<{
        readonly kind: 'exited';
        readonly service: string;
        readonly exitCode: number;
      }>((resolve) => {
        finish = () => {
          resolve({ kind: 'exited', service: request.service, exitCode: 0 });
        };
      });
      const delivered = (action: 'stdin-chunk' | 'stdin-end' | 'resize' | 'signal') => {
        observed.controls.push(action);
        if (action === 'stdin-end') {
          finish();
        }
        return Promise.resolve({
          kind: 'delivered' as const,
          action,
          mechanism: 'docker-stream' as const,
        });
      };
      return {
        kind: 'started',
        execution: {
          completion,
          writeStdin: () => delivered('stdin-chunk'),
          endStdin: () => delivered('stdin-end'),
          resize: () => delivered('resize'),
          signal: () => delivered('signal'),
          forceTerminate: () => delivered('signal'),
        },
      };
    },
  };
}

afterEach(async () => {
  await cleanDriverProjects();
});

it('prepares and runs the supplied host executable with mapped connection data', async () => {
  const directory = await driverProject(`export default {
    kind: 'project-driver', name: 'http', prepare(request) {
      return { kind: 'prepared-command', argv: request.command.argv,
        environment: { DRIVER_VALUE: request.target.endpoint.url },
        propagation: { kind: 'context-injected', format: 'w3c-trace-context', carrier: 'http-headers' },
        redaction: { kind: 'driver-redaction', requestArgv: { kind: 'none' },
          preparedArgv: { kind: 'none' }, environment: { kind: 'none' } } };
    }
  };`);
  await expect(runCapsuleDriver(driverInput(directory))).resolves.toMatchObject({
    kind: 'driver-completed',
    propagation: {
      kind: 'telemetry-propagation-v1',
      expectation: { kind: 'w3c-trace-context-propagation' },
      outcome: { kind: 'context-injected', carrier: 'http-headers' },
    },
    process: { kind: 'exited', exitCode: 0, stdout: 'http://127.0.0.1:4321' },
  });
});

it('refuses a promised carrier that the driver did not inject', async () => {
  const directory = await driverProject(`export default {
    kind: 'project-driver', name: 'http', prepare(request) {
      return { kind: 'prepared-command', argv: request.command.argv, environment: {},
        propagation: {
          kind: 'context-injection-failed',
          format: 'w3c-trace-context',
          carrier: 'http-headers',
          message: 'curl flags unavailable'
        },
        redaction: { kind: 'driver-redaction', requestArgv: { kind: 'none' },
          preparedArgv: { kind: 'none' }, environment: { kind: 'none' } } };
    }
  };`);
  await expect(runCapsuleDriver(driverInput(directory))).resolves.toMatchObject({
    kind: 'driver-propagation-refused',
    driverId: 'http',
    propagation: {
      kind: 'telemetry-propagation-v1',
      outcome: { kind: 'context-injection-failed', message: 'curl flags unavailable' },
    },
  });
});

it('streams a driver-selected participant TTY and forwards every control', async () => {
  const directory = await driverProject(`export default {
    kind: 'project-driver', name: 'postgres', prepare(request) {
      return { kind: 'prepared-command', argv: request.command.argv, environment: {},
        propagation: { kind: 'context-not-supported', boundary: 'shared-state', resource: 'postgresql' },
        redaction: { kind: 'driver-redaction', requestArgv: { kind: 'none' },
          preparedArgv: { kind: 'none' }, environment: { kind: 'none' } } };
    }
  };`);
  const selected = {
    ...httpDriver,
    id: 'postgres',
    execution: { kind: 'participant', participantId: 'postgres', service: 'postgres' },
    propagation: {
      kind: 'shared-state-propagation-unsupported',
      resource: 'postgresql',
    },
  } satisfies ResolvedCatalogDriver;
  const observed = { requests: [] as SandboxContainerExecutionInput[], controls: [] as string[] };
  const events: CapsuleInteractiveEvent[] = [];
  async function* controls(): AsyncGenerator<CapsuleInteractiveControl> {
    await Promise.resolve();
    yield { kind: 'stdin-chunk', controlId: 'input', chunk: Buffer.from('select 1;') };
    yield { kind: 'resize', controlId: 'resize', size: { columns: 120, rows: 40 } };
    yield { kind: 'signal', controlId: 'signal', signal: 'SIGINT' };
    yield { kind: 'stdin-end', controlId: 'end' };
  }
  const result = await runCapsuleDriver({
    ...driverInput(directory, selected),
    sandbox: participantSandbox(observed),
    interaction: {
      kind: 'interactive',
      cancellation: { kind: 'not-cancellable' },
      terminal: { columns: 120, rows: 40 },
      controls: controls(),
      onEvent: (event) => {
        events.push(event);
        return Promise.resolve();
      },
    },
  });
  expect(result).toMatchObject({
    kind: 'driver-completed',
    process: { kind: 'exited', stdout: 'participant-live', exitCode: 0 },
  });
  expect(observed.requests[0]).toMatchObject({
    service: 'postgres',
    terminal: { kind: 'tty', columns: 120, rows: 40 },
  });
  expect(observed.controls).toEqual(['stdin-chunk', 'resize', 'signal', 'stdin-end']);
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'output', stream: 'terminal' }),
      expect.objectContaining({ kind: 'control-result', controlId: 'signal' }),
    ]),
  );
});
