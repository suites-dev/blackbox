import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Readable } from 'node:stream';

import type {
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
} from '../output-retention.js';

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
  if (input.state.stdinEnded && (control.kind === 'stdin-chunk' || control.kind === 'stdin-end')) {
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
    const failure = error instanceof Error ? error : new Error(String(error));
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
  readonly interaction: CapsuleExecutionInteraction;
}): Promise<void> {
  for await (const control of input.interaction.controls) {
    const result = await hostControl({ child: input.child, state: input.state, control });
    if (input.interaction.kind === 'interactive') {
      await input.interaction
        .onEvent({ kind: 'control-result', controlId: control.controlId, result })
        .catch(() => undefined);
    }
  }
}

function observeOutput(input: {
  readonly stream: Readable;
  readonly kind: 'stdout' | 'stderr';
  readonly retention: ReturnType<typeof createOutputRetention>;
  readonly interaction: CapsuleExecutionInteraction;
}): { readonly settled: () => Promise<void> } {
  let pending: Promise<void> | null = null;
  input.stream.on('data', (chunk: Buffer) => {
    input.retention.append(chunk);
    if (input.interaction.kind === 'captured') {
      return;
    }
    input.stream.pause();
    const delivery = input.interaction
      .onEvent({ kind: 'output', stream: input.kind, chunk })
      .catch(() => undefined);
    pending = delivery;
    void delivery.finally(() => {
      if (pending === delivery) {
        pending = null;
      }
      if (!input.stream.destroyed) {
        input.stream.resume();
      }
    });
  });
  return {
    settled: async () => {
      while (pending !== null) {
        await pending;
      }
    },
  };
}

async function* noControls(): AsyncGenerator<CapsuleExecutionControl> {
  await Promise.resolve();
  yield* [];
}

export function runHost(input: HostProcessInput): Promise<CapsuleProcessOutcome> {
  return runHostWithInteraction({
    ...input,
    interaction: { kind: 'captured', controls: noControls() },
  });
}

export function runHostWithInteraction(
  input: HostProcessInput & { readonly interaction: CapsuleExecutionInteraction },
): Promise<CapsuleProcessOutcome> {
  return runHostWithRedaction({ ...input, secrets: [] });
}

function completedOutcome(input: {
  readonly process: HostProcessInput;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: ReturnType<typeof createOutputRetention>;
  readonly stderr: ReturnType<typeof createOutputRetention>;
}): CapsuleProcessOutcome {
  const stdout = input.stdout.finish();
  const stderr = input.stderr.finish();
  const shared = {
    argv: [...input.process.argv],
    location: { kind: 'host' as const },
    stdout: retainedOutputText(stdout),
    stderr: retainedOutputText(stderr),
    retention: { stdout: retainedOutputMetadata(stdout), stderr: retainedOutputMetadata(stderr) },
  };
  return input.signal === null
    ? { kind: 'exited', ...shared, exitCode: input.exitCode ?? 1 }
    : { kind: 'signaled', ...shared, signal: input.signal };
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
    const stdoutFlow = observeOutput({
      stream: child.stdout,
      kind: 'stdout',
      retention: stdout,
      interaction: input.interaction,
    });
    const stderrFlow = observeOutput({
      stream: child.stderr,
      kind: 'stderr',
      retention: stderr,
      interaction: input.interaction,
    });
    const state = { completed: false, stdinEnded: input.interaction.kind === 'captured' };
    let settled = false;
    child.stdin.on('error', () => undefined);
    if (state.stdinEnded) {
      child.stdin.end();
    }
    void pumpHostControls({ child, state, interaction: input.interaction }).catch(() => undefined);
    child.once('error', (error: NodeJS.ErrnoException) => {
      if (settled) {
        return;
      }
      settled = true;
      state.completed = true;
      if (error.code !== 'ENOENT') {
        reject(error);
        return;
      }
      resolve({
        kind: 'executable-not-found',
        argv: [...input.argv],
        location: { kind: 'host' },
        remediation: `Install ${JSON.stringify(command)} on the host or select a driver with participant execution.`,
      });
    });
    child.once('close', (exitCode, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      state.completed = true;
      void Promise.all([stdoutFlow.settled(), stderrFlow.settled()]).then(() => {
        resolve(completedOutcome({ process: input, exitCode, signal, stdout, stderr }));
      }, reject);
    });
  });
}
