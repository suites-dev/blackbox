import { Writable, type Duplex } from 'node:stream';
import { getContainerRuntimeClient } from 'testcontainers';
import { asError } from '../../lifecycle/errors.js';
import { dockerExecutionControl } from './docker-control.js';
import type {
  SandboxContainerExecutionFailure,
  SandboxContainerExecutionInput,
  SandboxContainerExecutionOutcome,
  SandboxContainerExecutionStartResult,
  SandboxContainerOutputEvent,
} from './types.js';

export async function startDockerContainerExecution(input: {
  readonly containerId: string;
  readonly request: SandboxContainerExecutionInput;
}): Promise<SandboxContainerExecutionStartResult> {
  try {
    const runtime = await getContainerRuntimeClient();
    const client = dockerExecutionClient(runtime);
    return await startDockerContainerExecutionWithClient({ ...input, client });
  } catch (cause) {
    return { kind: 'execution-failed', failure: runtimeFailure('create', cause) };
  }
}

export async function startDockerContainerExecutionWithClient(input: {
  readonly containerId: string;
  readonly request: SandboxContainerExecutionInput;
  readonly client: DockerExecutionClient;
}): Promise<SandboxContainerExecutionStartResult> {
  const client = input.client;
  const container = client.getContainer({ id: input.containerId });
  let exec;
  try {
    exec = await container.exec(createOptions(input.request));
  } catch (cause) {
    return { kind: 'execution-failed', failure: runtimeFailure('create', cause) };
  }
  let stream: Duplex;
  try {
    stream = await exec.start({
      hijack: true,
      stdin: true,
      Detach: false,
      Tty: input.request.terminal.kind === 'tty',
    });
  } catch (cause) {
    return { kind: 'execution-failed', failure: startFailure(input.request, cause) };
  }
  const diagnostics = { text: '' };
  attachOutput({ client, stream, request: input.request, diagnostics });
  const state = { completed: false, stdinEnded: false };
  const completion = observeCompletion({
    exec,
    stream,
    service: input.request.service,
    executable: input.request.argv[0],
    diagnostics,
    state,
  });
  return {
    kind: 'started',
    execution: dockerExecutionControl({
      exec,
      stream,
      terminal: input.request.terminal,
      state,
      completion,
    }),
  };
}

function createOptions(input: SandboxContainerExecutionInput) {
  const tty = input.terminal.kind === 'tty';
  return {
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: tty,
    Cmd: [...input.argv],
    Env: Object.entries(input.environment).map(([key, value]) => `${key}=${value}`),
    ...(tty
      ? { ConsoleSize: [input.terminal.rows, input.terminal.columns] as [number, number] }
      : {}),
  };
}

function attachOutput(input: {
  readonly client: DockerExecutionClient;
  readonly stream: Duplex;
  readonly request: SandboxContainerExecutionInput;
  readonly diagnostics: ExecutionDiagnostics;
}): void {
  if (input.request.terminal.kind === 'tty') {
    input.stream.on('data', (chunk: Buffer) => {
      retainDiagnostic(input.diagnostics, chunk);
      emit(input.request, 'terminal-output', chunk);
    });
    return;
  }
  const stdout = outputSink(input.request, 'stdout', input.diagnostics);
  const stderr = outputSink(input.request, 'stderr', input.diagnostics);
  input.client.demux({ stream: input.stream, stdout, stderr });
}

function dockerExecutionClient(
  runtime: Awaited<ReturnType<typeof getContainerRuntimeClient>>,
): DockerExecutionClient {
  return {
    getContainer: (input) => runtime.container.getById(input.id),
    demux: (input) => {
      runtime.container.dockerode.modem.demuxStream(input.stream, input.stdout, input.stderr);
    },
  };
}

function outputSink(
  request: SandboxContainerExecutionInput,
  kind: 'stdout' | 'stderr',
  diagnostics: ExecutionDiagnostics,
): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      retainDiagnostic(diagnostics, chunk);
      emit(request, kind, chunk);
      callback();
    },
  });
}

function emit(
  request: SandboxContainerExecutionInput,
  kind: SandboxContainerOutputEvent['kind'],
  chunk: Buffer,
): void {
  try {
    const event = { kind, chunk: new Uint8Array(chunk) } satisfies SandboxContainerOutputEvent;
    request.onOutput(event);
  } catch {
    // An observer cannot break or terminate the owned Docker exec stream.
  }
}

function observeCompletion(input: {
  readonly exec: { inspect(): Promise<{ Running: boolean; ExitCode: number | null }> };
  readonly stream: Duplex;
  readonly service: string;
  readonly executable: string;
  readonly diagnostics: ExecutionDiagnostics;
  readonly state: { completed: boolean };
}): Promise<SandboxContainerExecutionOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: SandboxContainerExecutionOutcome): void => {
      if (settled) {
        return;
      }
      settled = true;
      input.state.completed = true;
      resolve(outcome);
    };
    input.stream.once('error', (cause) => {
      finish(failed(runtimeFailure('stream', cause)));
    });
    const inspect = (): void => {
      void inspectOutcome(input).then(finish);
    };
    input.stream.once('end', inspect);
    input.stream.once('close', inspect);
  });
}

async function inspectOutcome(input: {
  readonly exec: { inspect(): Promise<{ Running: boolean; ExitCode: number | null }> };
  readonly service: string;
  readonly executable: string;
  readonly diagnostics: ExecutionDiagnostics;
}): Promise<SandboxContainerExecutionOutcome> {
  try {
    const inspection = await input.exec.inspect();
    if (inspection.Running || inspection.ExitCode === null) {
      return failed(runtimeFailure('inspect', new Error('Docker exec stream ended before exit')));
    }
    if (
      inspection.ExitCode !== 0 &&
      isMissingExecutable(input.diagnostics.text, input.executable)
    ) {
      return failed({
        kind: 'executable-not-found',
        service: input.service,
        executable: input.executable,
        error: { name: 'DockerExecError', message: input.diagnostics.text.trim() },
      });
    }
    return { kind: 'exited', service: input.service, exitCode: inspection.ExitCode };
  } catch (cause) {
    return failed(runtimeFailure('inspect', cause));
  }
}

function startFailure(
  input: SandboxContainerExecutionInput,
  cause: unknown,
): SandboxContainerExecutionFailure {
  const error = asError(cause);
  if (isMissingExecutable(error.message, input.argv[0])) {
    return {
      kind: 'executable-not-found',
      service: input.service,
      executable: input.argv[0],
      error: { name: error.name, message: error.message },
    };
  }
  return runtimeFailure('start', error);
}

function isMissingExecutable(message: string, executable: string): boolean {
  return (
    message.includes(executable) &&
    (message.includes('executable file not found') || message.includes('no such file or directory'))
  );
}

interface ExecutionDiagnostics {
  text: string;
}

interface DockerExecutionClient {
  getContainer(input: { readonly id: string }): DockerContainerPort;
  demux(input: {
    readonly stream: Duplex;
    readonly stdout: Writable;
    readonly stderr: Writable;
  }): void;
}

interface DockerContainerPort {
  exec(input: ReturnType<typeof createOptions>): Promise<DockerExecPort>;
}

interface DockerExecPort {
  start(input: {
    readonly hijack: true;
    readonly stdin: true;
    readonly Detach: false;
    readonly Tty: boolean;
  }): Promise<Duplex>;
  inspect(): Promise<{ readonly Running: boolean; readonly ExitCode: number | null }>;
  resize(input: { readonly h: number; readonly w: number }): Promise<unknown>;
}

function retainDiagnostic(target: ExecutionDiagnostics, chunk: Buffer): void {
  const limit = 65_536;
  target.text = `${target.text}${chunk.toString('utf8')}`.slice(-limit);
}

function runtimeFailure(
  phase: 'create' | 'start' | 'stream' | 'inspect',
  cause: unknown,
): SandboxContainerExecutionFailure {
  const error = asError(cause);
  return { kind: 'runtime-error', phase, error: { name: error.name, message: error.message } };
}

function failed(failure: SandboxContainerExecutionFailure): SandboxContainerExecutionOutcome {
  return { kind: 'execution-failed', failure };
}
