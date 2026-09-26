import { PassThrough } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { startDockerContainerExecutionWithClient } from './docker-engine.js';
import type {
  SandboxContainerExecutionInput,
  SandboxContainerExecutionStartResult,
} from './types.js';

type EngineInput = Parameters<typeof startDockerContainerExecutionWithClient>[0];
type EngineClient = EngineInput['client'];
type EngineExec = ReturnType<EngineClient['getContainer']>['exec'];

function request(
  onOutput: SandboxContainerExecutionInput['onOutput'],
  terminal: SandboxContainerExecutionInput['terminal'] = { kind: 'captured' },
): SandboxContainerExecutionInput {
  return {
    kind: 'container-stream-exec',
    service: 'postgres',
    argv: ['psql', '--no-psqlrc'],
    environment: { PGDATABASE: 'subscriptions' },
    terminal,
    onOutput,
  };
}

function started(result: SandboxContainerExecutionStartResult) {
  if (result.kind === 'execution-failed') {
    throw new Error(`Expected execution to start, received ${result.failure.kind}`);
  }
  return result.execution;
}

it('passes exact argv and environment and demultiplexes captured output', async () => {
  const stream = new PassThrough();
  const exec = vi.fn(() => Promise.resolve(executionPort(stream, 0)));
  const output: string[] = [];
  const result = await startDockerContainerExecutionWithClient({
    containerId: 'postgres-id',
    request: request((event) => {
      output.push(`${event.kind}:${Buffer.from(event.chunk).toString()}`);
      return Promise.resolve();
    }),
    client: client(exec, (input) => input.stream.pipe(input.stdout)),
  });
  const execution = started(result);
  await execution.writeStdin({ kind: 'stdin-chunk', chunk: Buffer.from('select 1;') });
  await execution.endStdin();

  await expect(execution.completion).resolves.toEqual({
    kind: 'exited',
    service: 'postgres',
    exitCode: 0,
  });
  expect(output).toEqual(['stdout:select 1;']);
  expect(exec).toHaveBeenCalledWith({
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
    Cmd: ['psql', '--no-psqlrc'],
    Env: ['PGDATABASE=subscriptions'],
  });
});

it('streams tty output and passes the declared console dimensions', async () => {
  const stream = new PassThrough();
  const exec = vi.fn(() => Promise.resolve(executionPort(stream, 0)));
  const output: string[] = [];
  const result = await startDockerContainerExecutionWithClient({
    containerId: 'postgres-id',
    request: request(
      (event) => {
        output.push(`${event.kind}:${Buffer.from(event.chunk).toString()}`);
        return Promise.resolve();
      },
      { kind: 'tty', columns: 120, rows: 40 },
    ),
    client: client(exec, () => {
      throw new Error('TTY output must not use Docker demultiplexing');
    }),
  });
  const execution = started(result);
  stream.end('interactive output');
  await expect(execution.completion).resolves.toEqual({
    kind: 'exited',
    service: 'postgres',
    exitCode: 0,
  });
  expect(output).toEqual(['terminal-output:interactive output']);
  expect(exec).toHaveBeenCalledWith(expect.objectContaining({ Tty: true, ConsoleSize: [40, 120] }));
});

it('classifies missing executables reported through the Docker stream', async () => {
  const stream = new PassThrough();
  const exec = vi.fn(() => Promise.resolve(executionPort(stream, 127)));
  const result = await startDockerContainerExecutionWithClient({
    containerId: 'postgres-id',
    request: request(() => Promise.resolve()),
    client: client(exec, (input) => input.stream.pipe(input.stderr)),
  });
  const execution = started(result);
  stream.end('exec: "psql": executable file not found in $PATH');

  await expect(execution.completion).resolves.toMatchObject({
    kind: 'execution-failed',
    failure: { kind: 'executable-not-found', service: 'postgres', executable: 'psql' },
  });
});

it('returns typed create and start failures', async () => {
  const createFailure = await startDockerContainerExecutionWithClient({
    containerId: 'postgres-id',
    request: request(() => Promise.resolve()),
    client: client(
      () => Promise.reject(new Error('create failed')),
      () => undefined,
    ),
  });
  expect(createFailure).toEqual({
    kind: 'execution-failed',
    failure: {
      kind: 'runtime-error',
      phase: 'create',
      error: { name: 'Error', message: 'create failed' },
    },
  });

  const stream = new PassThrough();
  const port = executionPort(stream, 127);
  port.start = () => Promise.reject(new Error('exec: "psql": executable file not found in $PATH'));
  const startFailure = await startDockerContainerExecutionWithClient({
    containerId: 'postgres-id',
    request: request(() => Promise.resolve()),
    client: client(
      () => Promise.resolve(port),
      () => undefined,
    ),
  });
  expect(startFailure).toMatchObject({
    kind: 'execution-failed',
    failure: { kind: 'executable-not-found', service: 'postgres', executable: 'psql' },
  });

  port.start = () => Promise.reject(new Error('Docker exec start failed'));
  const genericStartFailure = await startDockerContainerExecutionWithClient({
    containerId: 'postgres-id',
    request: request(() => Promise.resolve()),
    client: client(
      () => Promise.resolve(port),
      () => undefined,
    ),
  });
  expect(genericStartFailure).toEqual({
    kind: 'execution-failed',
    failure: {
      kind: 'runtime-error',
      phase: 'start',
      error: { name: 'Error', message: 'Docker exec start failed' },
    },
  });
});

it('retains stream and inspection failures without throwing from completion', async () => {
  const brokenStream = new PassThrough();
  const streamFailure = await startDockerContainerExecutionWithClient({
    containerId: 'postgres-id',
    request: request(() => Promise.resolve()),
    client: client(
      () => Promise.resolve(executionPort(brokenStream, 0)),
      () => undefined,
    ),
  });
  const streamExecution = started(streamFailure);
  brokenStream.emit('error', new Error('Docker stream failed'));
  await expect(streamExecution.completion).resolves.toEqual({
    kind: 'execution-failed',
    failure: {
      kind: 'runtime-error',
      phase: 'stream',
      error: { name: 'Error', message: 'Docker stream failed' },
    },
  });

  const inspectStream = new PassThrough();
  const inspectPort = executionPort(inspectStream, 0);
  inspectPort.inspect = () => Promise.reject(new Error('inspect failed'));
  const inspectFailure = await startDockerContainerExecutionWithClient({
    containerId: 'postgres-id',
    request: request(() => Promise.resolve()),
    client: client(
      () => Promise.resolve(inspectPort),
      (input) => input.stream.resume(),
    ),
  });
  const inspectExecution = started(inspectFailure);
  inspectStream.end();
  await expect(inspectExecution.completion).resolves.toEqual({
    kind: 'execution-failed',
    failure: {
      kind: 'runtime-error',
      phase: 'inspect',
      error: { name: 'Error', message: 'inspect failed' },
    },
  });
});

it('isolates output observers and rejects a stream that closes before Docker exits', async () => {
  const stream = new PassThrough();
  const port = executionPort(stream, 0);
  port.inspect = () => Promise.resolve({ Running: true, ExitCode: 0 });
  const result = await startDockerContainerExecutionWithClient({
    containerId: 'postgres-id',
    request: request(() => Promise.reject(new Error('observer failed'))),
    client: client(
      () => Promise.resolve(port),
      (input) => input.stream.pipe(input.stdout),
    ),
  });
  const execution = started(result);
  stream.end('visible output');
  await expect(execution.completion).resolves.toMatchObject({
    kind: 'execution-failed',
    failure: {
      kind: 'runtime-error',
      phase: 'inspect',
      error: { message: 'Docker exec stream ended before exit' },
    },
  });
});

function client(exec: EngineExec, demux: EngineClient['demux']): EngineClient {
  return { getContainer: () => ({ exec }), demux };
}

function executionPort(stream: PassThrough, exitCode: number) {
  return {
    start: () => Promise.resolve(stream),
    inspect: () => Promise.resolve({ Running: false, ExitCode: exitCode }),
    resize: () => Promise.resolve(),
  };
}
