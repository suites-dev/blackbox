import type { ChildProcessWithoutNullStreams } from 'node:child_process';

import type {
  CapsuleExecutionCancellation,
  CapsuleExecutionControl,
  CapsuleExecutionInteraction,
  CapsuleInteractiveControl,
  CapsuleInteractiveControlResult,
} from '../types.js';

export interface HostControlState {
  completed: boolean;
  stdinEnded: boolean;
}

function signalHostExecution(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
): boolean {
  if (process.platform === 'win32' || child.pid === undefined) {
    return child.kill(signal);
  }
  try {
    process.kill(-child.pid, signal);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
      return child.kill(signal);
    }
    throw error;
  }
}

function closeHostProcessStreams(child: ChildProcessWithoutNullStreams): void {
  child.stdin.destroy();
  child.stdout.destroy();
  child.stderr.destroy();
}

function rejectedControl(
  action: CapsuleInteractiveControlResult['action'],
  reason: 'execution-completed' | 'stdin-ended',
): CapsuleInteractiveControlResult {
  return { kind: 'rejected', action, reason };
}

function writeHostStdin(input: {
  readonly child: ChildProcessWithoutNullStreams;
  readonly cancellation: CapsuleExecutionCancellation;
  readonly control: Extract<CapsuleInteractiveControl, { readonly kind: 'stdin-chunk' }>;
}): Promise<CapsuleInteractiveControlResult> {
  return new Promise((resolve) => {
    const signal = input.cancellation.kind === 'abort-signal' ? input.cancellation.signal : null;
    let settled = false;
    const finish = (result: CapsuleInteractiveControlResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (signal !== null) {
        signal.removeEventListener('abort', abort);
      }
      resolve(result);
    };
    const abort = (): void => {
      input.child.stdin.destroy();
      finish({
        kind: 'failed',
        action: 'stdin-chunk',
        error: { name: 'AbortError', message: 'Host stdin write was cancelled.' },
      });
    };
    if (signal !== null && signal.aborted) {
      abort();
      return;
    }
    if (signal !== null) {
      signal.addEventListener('abort', abort, { once: true });
    }
    input.child.stdin.write(Buffer.from(input.control.chunk), (error) => {
      finish(
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

function signalFailure(error: unknown): CapsuleInteractiveControlResult {
  const failure = error instanceof Error ? error : new Error(String(error));
  return {
    kind: 'failed',
    action: 'signal',
    error: { name: failure.name, message: failure.message },
  };
}

async function hostControl(input: {
  readonly child: ChildProcessWithoutNullStreams;
  readonly state: HostControlState;
  readonly interaction: CapsuleExecutionInteraction;
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
    try {
      const delivered = signalHostExecution(input.child, 'SIGKILL');
      if (delivered) {
        closeHostProcessStreams(input.child);
      }
      return delivered
        ? { kind: 'delivered', action: 'signal', mechanism: 'host-process-signal' }
        : rejectedControl('signal', 'execution-completed');
    } catch (error) {
      return signalFailure(error);
    }
  }
  if (input.state.stdinEnded && (control.kind === 'stdin-chunk' || control.kind === 'stdin-end')) {
    return rejectedControl(control.kind, 'stdin-ended');
  }
  if (control.kind === 'stdin-chunk') {
    return await writeHostStdin({
      child: input.child,
      cancellation: input.interaction.cancellation,
      control,
    });
  }
  if (control.kind === 'stdin-end') {
    input.state.stdinEnded = true;
    if (
      input.interaction.cancellation.kind === 'abort-signal' &&
      input.interaction.cancellation.signal.aborted
    ) {
      input.child.stdin.destroy();
      return rejectedControl('stdin-end', 'stdin-ended');
    }
    return await endHostStdin(input.child);
  }
  if (control.kind === 'resize') {
    return { kind: 'unsupported', action: 'resize', reason: 'host-pty-unavailable' };
  }
  try {
    return signalHostExecution(input.child, control.signal)
      ? { kind: 'delivered', action: 'signal', mechanism: 'host-process-signal' }
      : rejectedControl('signal', 'execution-completed');
  } catch (error) {
    return signalFailure(error);
  }
}

export async function pumpHostControls(input: {
  readonly child: ChildProcessWithoutNullStreams;
  readonly state: HostControlState;
  readonly interaction: CapsuleExecutionInteraction;
}): Promise<void> {
  for await (const control of input.interaction.controls) {
    const result = await hostControl({
      child: input.child,
      state: input.state,
      interaction: input.interaction,
      control,
    });
    if (input.interaction.kind === 'interactive') {
      await input.interaction
        .onEvent({ kind: 'control-result', controlId: control.controlId, result })
        .catch(() => undefined);
    }
  }
}
