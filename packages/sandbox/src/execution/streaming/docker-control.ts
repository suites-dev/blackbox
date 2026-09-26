import type { Duplex } from 'node:stream';
import { asError } from '../../lifecycle/errors.js';
import type {
  SandboxContainerControlResult,
  SandboxContainerExecution,
  SandboxContainerExecutionOutcome,
  SandboxContainerResizeInput,
  SandboxContainerSignalInput,
  SandboxContainerStdinChunk,
  SandboxContainerTerminal,
} from './types.js';

interface DockerExecPort {
  resize(input: { readonly h: number; readonly w: number }): Promise<unknown>;
}

interface ExecutionState {
  completed: boolean;
  stdinEnded: boolean;
}

export function dockerExecutionControl(input: {
  readonly exec: DockerExecPort;
  readonly stream: Duplex;
  readonly terminal: SandboxContainerTerminal;
  readonly state: ExecutionState;
  readonly completion: Promise<SandboxContainerExecutionOutcome>;
}): SandboxContainerExecution {
  return {
    completion: input.completion,
    writeStdin: (request) => writeStdin({ ...input, request }),
    endStdin: () => endStdin(input),
    resize: (request) => resize({ ...input, request }),
    signal: (request) => signal({ ...input, request }),
    forceTerminate: () => forceTerminate(input),
  };
}

function forceTerminate(input: {
  readonly stream: Duplex;
  readonly state: ExecutionState;
}): Promise<SandboxContainerControlResult> {
  if (input.state.completed) {
    return Promise.resolve(rejected('signal', 'execution-completed'));
  }
  input.state.completed = true;
  input.stream.destroy();
  return Promise.resolve(delivered('signal', 'docker-stream-abort'));
}

async function writeStdin(input: {
  readonly stream: Duplex;
  readonly state: ExecutionState;
  readonly request: SandboxContainerStdinChunk;
}): Promise<SandboxContainerControlResult> {
  const rejected = inputRejection(input.state, 'stdin-chunk');
  if (rejected !== undefined) {
    return rejected;
  }
  return writeChunk(input.stream, input.request.chunk, 'stdin-chunk', 'docker-stream');
}

async function endStdin(input: {
  readonly stream: Duplex;
  readonly state: ExecutionState;
}): Promise<SandboxContainerControlResult> {
  const rejected = inputRejection(input.state, 'stdin-end');
  if (rejected !== undefined) {
    return rejected;
  }
  input.state.stdinEnded = true;
  return new Promise((resolve) => {
    input.stream.end(() => {
      resolve(delivered('stdin-end', 'docker-stream'));
    });
  });
}

async function resize(input: {
  readonly exec: DockerExecPort;
  readonly terminal: SandboxContainerTerminal;
  readonly state: ExecutionState;
  readonly request: SandboxContainerResizeInput;
}): Promise<SandboxContainerControlResult> {
  if (input.state.completed) {
    return rejected('resize', 'execution-completed');
  }
  if (input.terminal.kind === 'captured') {
    return { kind: 'unsupported', action: 'resize', reason: 'tty-required' };
  }
  if (!validSize(input.request)) {
    return rejected('resize', 'invalid-terminal-size');
  }
  try {
    await input.exec.resize({ h: input.request.rows, w: input.request.columns });
    return delivered('resize', 'docker-exec-resize');
  } catch (cause) {
    return controlFailure('resize', asError(cause));
  }
}

async function signal(input: {
  readonly stream: Duplex;
  readonly terminal: SandboxContainerTerminal;
  readonly state: ExecutionState;
  readonly request: SandboxContainerSignalInput;
}): Promise<SandboxContainerControlResult> {
  if (input.state.completed) {
    return rejected('signal', 'execution-completed');
  }
  const character = signalCharacter(input.request);
  if (input.terminal.kind === 'captured' || character.kind === 'unsupported') {
    return { kind: 'unsupported', action: 'signal', reason: 'docker-exec-signal-unsupported' };
  }
  return writeChunk(input.stream, character.chunk, 'signal', 'tty-control-character');
}

function signalCharacter(
  input: SandboxContainerSignalInput,
): { readonly kind: 'supported'; readonly chunk: Uint8Array } | { readonly kind: 'unsupported' } {
  if (input.signal === 'SIGINT') {
    return { kind: 'supported', chunk: Uint8Array.of(3) };
  }
  if (input.signal === 'SIGQUIT') {
    return { kind: 'supported', chunk: Uint8Array.of(28) };
  }
  return { kind: 'unsupported' };
}

function writeChunk(
  stream: Duplex,
  chunk: Uint8Array,
  action: 'stdin-chunk' | 'signal',
  mechanism: 'docker-stream' | 'tty-control-character',
): Promise<SandboxContainerControlResult> {
  return new Promise((resolve) => {
    stream.write(Buffer.from(chunk), (error) => {
      if (error) {
        resolve(controlFailure(action, error));
      } else {
        resolve(delivered(action, mechanism));
      }
    });
  });
}

function inputRejection(
  state: ExecutionState,
  action: 'stdin-chunk' | 'stdin-end',
): SandboxContainerControlResult | undefined {
  if (state.completed) {
    return rejected(action, 'execution-completed');
  }
  if (state.stdinEnded) {
    return rejected(action, 'stdin-ended');
  }
  return undefined;
}

function validSize(input: SandboxContainerResizeInput): boolean {
  return (
    Number.isInteger(input.columns) &&
    input.columns > 0 &&
    Number.isInteger(input.rows) &&
    input.rows > 0
  );
}

function delivered(
  action: 'stdin-chunk' | 'stdin-end' | 'resize' | 'signal',
  mechanism:
    | 'docker-stream'
    | 'docker-stream-abort'
    | 'docker-exec-resize'
    | 'tty-control-character',
): SandboxContainerControlResult {
  return { kind: 'delivered', action, mechanism };
}

function rejected(
  action: 'stdin-chunk' | 'stdin-end' | 'resize' | 'signal',
  reason: 'execution-completed' | 'stdin-ended' | 'invalid-terminal-size',
): SandboxContainerControlResult {
  return { kind: 'rejected', action, reason };
}

function controlFailure(
  action: 'stdin-chunk' | 'stdin-end' | 'resize' | 'signal',
  error: Error,
): SandboxContainerControlResult {
  return { kind: 'failed', action, error: { name: error.name, message: error.message } };
}
