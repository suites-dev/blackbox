import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import type {
  CapsuleEntrypoint,
  CapsuleExecutionControl,
  CapsuleExecutionInteraction,
  CapsuleInteractiveControl,
  CapsuleInteractiveControlResult,
  CapsuleProcessOutcome,
} from '../types.js';
import {
  createOutputRetention,
  retainedOutputMetadata,
  retainedOutputText,
} from './output-retention.js';

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export async function awaitReadiness(input: {
  readonly entrypoint: CapsuleEntrypoint;
  readonly path: string;
  readonly timeoutMs: number;
}): Promise<void> {
  const deadline = Date.now() + input.timeoutMs;
  const url = new URL(input.path, `${input.entrypoint.url}/`);
  let lastError = new Error('Readiness endpoint was not attempted');
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) {
        return;
      }
      lastError = new Error(`Readiness returned HTTP ${response.status}`);
    } catch (error) {
      lastError = asError(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Readiness did not succeed within ${input.timeoutMs}ms`, { cause: lastError });
}

interface HostProcessInput {
  readonly argv: readonly [string, ...string[]];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
}

interface HostControlState {
  completed: boolean;
  stdinEnded: boolean;
}

function rejectedControl(
  action: CapsuleInteractiveControlResult['action'],
  reason: 'execution-completed' | 'stdin-ended',
): CapsuleInteractiveControlResult {
  return { kind: 'rejected', action, reason };
}

function writeHostStdin(input: {
  readonly child: ChildProcessWithoutNullStreams;
  readonly control: Extract<CapsuleInteractiveControl, { readonly kind: 'stdin-chunk' }>;
}): Promise<CapsuleInteractiveControlResult> {
  return new Promise((resolve) => {
    input.child.stdin.write(Buffer.from(input.control.chunk), (error) => {
      resolve(
        error === null || error === undefined
          ? { kind: 'delivered', action: 'stdin-chunk', mechanism: 'host-process-stdin' }
          : {
              kind: 'failed',
              action: 'stdin-chunk',
              error: { name: error.name, message: error.message },
            },
      );
    });
  });
}

function endHostStdin(
  child: ChildProcessWithoutNullStreams,
): Promise<CapsuleInteractiveControlResult> {
  return new Promise((resolve) => {
    child.stdin.end(() => {
      resolve({ kind: 'delivered', action: 'stdin-end', mechanism: 'host-process-stdin' });
    });
  });
}

async function hostControl(input: {
  readonly child: ChildProcessWithoutNullStreams;
  readonly state: HostControlState;
  readonly control: CapsuleExecutionControl;
}): Promise<CapsuleInteractiveControlResult> {
  const { control } = input;
  if (input.state.completed) {
    return rejectedControl(
      control.kind === 'force-terminate' ? 'signal' : control.kind,
      'execution-completed',
    );
  }
  if (control.kind === 'force-terminate') {
    return input.child.kill('SIGKILL')
      ? { kind: 'delivered', action: 'signal', mechanism: 'host-process-signal' }
      : rejectedControl('signal', 'execution-completed');
  }
  if (
    input.state.stdinEnded &&
    (control.kind === 'stdin-chunk' || control.kind === 'stdin-end')
  ) {
    return rejectedControl(control.kind, 'stdin-ended');
  }
  if (control.kind === 'stdin-chunk') {
    return await writeHostStdin({ child: input.child, control });
  }
  if (control.kind === 'stdin-end') {
    input.state.stdinEnded = true;
    return await endHostStdin(input.child);
  }
  if (control.kind === 'resize') {
    return { kind: 'unsupported', action: 'resize', reason: 'host-pty-unavailable' };
  }
  try {
    return input.child.kill(control.signal)
      ? { kind: 'delivered', action: 'signal', mechanism: 'host-process-signal' }
      : rejectedControl('signal', 'execution-completed');
  } catch (error) {
    const failure = asError(error);
    return {
      kind: 'failed',
      action: 'signal',
      error: { name: failure.name, message: failure.message },
    };
  }
}

async function pumpHostControls(input: {
  readonly child: ChildProcessWithoutNullStreams;
  readonly state: HostControlState;
  readonly interaction: Extract<CapsuleExecutionInteraction, { readonly kind: 'interactive' }>;
}): Promise<void> {
  for await (const control of input.interaction.controls) {
    input.interaction.onEvent({
      kind: 'control-result',
      controlId: control.controlId,
      result: await hostControl({ child: input.child, state: input.state, control }),
    });
  }
}

function emitHostOutput(
  interaction: CapsuleExecutionInteraction,
  stream: 'stdout' | 'stderr',
  chunk: Buffer,
): void {
  if (interaction.kind === 'interactive') {
    interaction.onEvent({ kind: 'output', stream, chunk });
  }
}

export function runHost(input: HostProcessInput): Promise<CapsuleProcessOutcome> {
  return runHostWithInteraction({ ...input, interaction: { kind: 'captured' } });
}

export function runHostWithInteraction(
  input: HostProcessInput & { readonly interaction: CapsuleExecutionInteraction },
): Promise<CapsuleProcessOutcome> {
  return runHostWithRedaction({ ...input, secrets: [] });
}

export function runHostWithRedaction(
  input: HostProcessInput & {
    readonly interaction: CapsuleExecutionInteraction;
    readonly secrets: readonly string[];
  },
): Promise<CapsuleProcessOutcome> {
  return new Promise((resolve, reject) => {
    const [command, ...arguments_] = input.argv;
    const child = spawn(command, arguments_, {
      cwd: input.cwd,
      env: { ...process.env, ...input.environment },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = createOutputRetention({ secrets: input.secrets });
    const stderr = createOutputRetention({ secrets: input.secrets });
    const controlState = { completed: false, stdinEnded: false };
    let settled = false;
    child.stdout.on('data', (chunk: Buffer) => {
      stdout.append(chunk);
      emitHostOutput(input.interaction, 'stdout', chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.append(chunk);
      emitHostOutput(input.interaction, 'stderr', chunk);
    });
    child.stdin.on('error', () => undefined);
    if (input.interaction.kind === 'captured') {
      controlState.stdinEnded = true;
      child.stdin.end();
    } else {
      void pumpHostControls({
        child,
        state: controlState,
        interaction: input.interaction,
      }).catch(() => undefined);
    }
    child.once('error', (error: NodeJS.ErrnoException) => {
      if (settled) {
        return;
      }
      settled = true;
      controlState.completed = true;
      if (error.code === 'ENOENT') {
        resolve({
          kind: 'executable-not-found',
          argv: [...input.argv],
          location: { kind: 'host' },
          remediation: `Install ${JSON.stringify(command)} on the host or select a driver with participant execution.`,
        });
        return;
      }
      reject(error);
    });
    child.once('close', (exitCode, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      controlState.completed = true;
      const retainedStdout = stdout.finish();
      const retainedStderr = stderr.finish();
      const shared = {
        argv: [...input.argv],
        location: { kind: 'host' as const },
        stdout: retainedOutputText(retainedStdout),
        stderr: retainedOutputText(retainedStderr),
        retention: {
          stdout: retainedOutputMetadata(retainedStdout),
          stderr: retainedOutputMetadata(retainedStderr),
        },
      };
      resolve(
        signal === null
          ? { kind: 'exited', ...shared, exitCode: exitCode ?? 1 }
          : { kind: 'signaled', ...shared, signal },
      );
    });
  });
}
