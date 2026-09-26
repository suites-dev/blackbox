import type { Socket } from 'node:net';

import { sendEvent } from '../../ipc/server.js';
import type {
  CapsuleManagerClientFrame,
  CapsuleManagerControlFrame,
  CapsuleManagerRequest,
} from '../../protocol.js';
import type {
  CapsuleExecutionControl,
  CapsuleExecutionInteraction,
  CapsuleInteractiveControl,
  CapsuleInteractiveEvent,
} from '../../types.js';

type ExecRequest = Extract<
  CapsuleManagerRequest,
  { readonly kind: 'exec-request' | 'interactive-exec-request' }
>;

interface ActiveExecution {
  readonly requestId: string;
  readonly socket: Socket;
  readonly cancelled: AbortController;
  readonly completed: AbortController;
}

type CoordinatorState =
  | { readonly kind: 'accepting'; readonly active: ActiveExecution | null }
  | { readonly kind: 'stopping'; readonly active: ActiveExecution | null };

export interface ManagerExecutionLease {
  readonly interaction: CapsuleExecutionInteraction;
  release(): void;
}

function isControl(frame: CapsuleManagerClientFrame): frame is CapsuleManagerControlFrame {
  return frame.kind.startsWith('exec-') && frame.kind !== 'exec-request';
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Capsule control: ${JSON.stringify(value)}`);
}

function decodeControl(frame: CapsuleManagerControlFrame): CapsuleInteractiveControl {
  switch (frame.kind) {
    case 'exec-stdin-chunk':
      return {
        kind: 'stdin-chunk',
        controlId: frame.controlId,
        chunk: Buffer.from(frame.chunk, 'base64'),
      };
    case 'exec-stdin-end':
      return { kind: 'stdin-end', controlId: frame.controlId };
    case 'exec-resize':
      return { kind: 'resize', controlId: frame.controlId, size: frame.terminal };
    case 'exec-signal':
      return { kind: 'signal', controlId: frame.controlId, signal: frame.signal };
    default:
      return assertNever(frame);
  }
}

function settlement(active: ActiveExecution): Promise<'cancelled' | 'completed'> {
  if (active.cancelled.signal.aborted) {
    return Promise.resolve('cancelled');
  }
  if (active.completed.signal.aborted) {
    return Promise.resolve('completed');
  }
  return new Promise((resolve) => {
    active.cancelled.signal.addEventListener(
      'abort',
      () => {
        resolve('cancelled');
      },
      { once: true },
    );
    active.completed.signal.addEventListener(
      'abort',
      () => {
        resolve('completed');
      },
      { once: true },
    );
  });
}

function disconnectGracePeriod(): Promise<'elapsed'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve('elapsed');
    }, 250);
    timer.unref();
  });
}

async function* terminationControls(
  active: ActiveExecution,
): AsyncGenerator<CapsuleExecutionControl> {
  yield {
    kind: 'signal',
    controlId: `${active.requestId}-transport-close-signal`,
    signal: 'SIGINT',
  };
  yield { kind: 'stdin-end', controlId: `${active.requestId}-transport-close-stdin` };
  const completion = new Promise<'completed'>((resolve) => {
    if (active.completed.signal.aborted) {
      resolve('completed');
      return;
    }
    active.completed.signal.addEventListener(
      'abort',
      () => {
        resolve('completed');
      },
      { once: true },
    );
  });
  if ((await Promise.race([disconnectGracePeriod(), completion])) === 'elapsed') {
    yield { kind: 'force-terminate', controlId: `${active.requestId}-transport-close-kill` };
  }
}

async function* capturedControls(active: ActiveExecution): AsyncGenerator<CapsuleExecutionControl> {
  if ((await settlement(active)) === 'cancelled') {
    yield* terminationControls(active);
  }
}

async function* interactiveControls(input: {
  readonly active: ActiveExecution;
  readonly frames: AsyncGenerator<CapsuleManagerClientFrame>;
}): AsyncGenerator<CapsuleExecutionControl> {
  const settled = settlement(input.active);
  for (;;) {
    const next = await Promise.race([
      input.frames.next().then(
        (frame) => ({ kind: 'frame' as const, frame }),
        () => ({ kind: 'disconnected' as const }),
      ),
      settled.then((result) => ({ kind: 'settled' as const, result })),
    ]);
    if (next.kind === 'settled') {
      if (next.result === 'cancelled') {
        yield* terminationControls(input.active);
      }
      return;
    }
    if (next.kind === 'disconnected') {
      yield* terminationControls(input.active);
      return;
    }
    if (next.frame.done) {
      yield* terminationControls(input.active);
      return;
    }
    const frame = next.frame.value;
    if (!isControl(frame)) {
      throw new Error(`Unexpected ${frame.kind} after interactive execution started`);
    }
    if (frame.requestId !== input.active.requestId) {
      throw new Error('Interactive control request identity does not match execution');
    }
    yield decodeControl(frame);
  }
}

function interactiveTransport(input: {
  readonly active: ActiveExecution;
  readonly request: Extract<ExecRequest, { readonly kind: 'interactive-exec-request' }>;
  readonly frames: AsyncGenerator<CapsuleManagerClientFrame>;
}): CapsuleExecutionInteraction {
  return {
    kind: 'interactive',
    terminal: input.request.terminal,
    controls: interactiveControls({ active: input.active, frames: input.frames }),
    onEvent: async (event: CapsuleInteractiveEvent) => {
      const frame =
        event.kind === 'output'
          ? {
              kind: 'exec-output' as const,
              requestId: input.request.requestId,
              stream: event.stream,
              chunk: Buffer.from(event.chunk).toString('base64'),
            }
          : {
              kind: 'exec-control-result' as const,
              requestId: input.request.requestId,
              controlId: event.controlId,
              result: event.result,
            };
      await sendEvent(input.active.socket, frame).catch(() => undefined);
    },
  };
}

export class ManagerExecutionCoordinator {
  #state: CoordinatorState = { kind: 'accepting', active: null };

  requestStop(): void {
    const active = this.#state.active;
    this.#state = { kind: 'stopping', active };
    if (active !== null) {
      active.cancelled.abort();
      active.socket.destroy();
    }
  }

  begin(input: {
    readonly socket: Socket;
    readonly request: ExecRequest;
    readonly frames: AsyncGenerator<CapsuleManagerClientFrame>;
  }): ManagerExecutionLease {
    if (this.#state.kind === 'stopping') {
      throw new Error('Cannot execute after Capsule stop was requested');
    }
    const active = {
      requestId: input.request.requestId,
      socket: input.socket,
      cancelled: new AbortController(),
      completed: new AbortController(),
    };
    this.#state = { kind: 'accepting', active };
    const interaction =
      input.request.kind === 'interactive-exec-request'
        ? interactiveTransport({ active, request: input.request, frames: input.frames })
        : { kind: 'captured' as const, controls: capturedControls(active) };
    return {
      interaction,
      release: () => {
        this.release(active);
      },
    };
  }

  private release(active: ActiveExecution): void {
    active.completed.abort();
    const current = this.#state.active;
    if (current !== null && current.requestId === active.requestId) {
      this.#state = { kind: this.#state.kind, active: null };
    }
  }
}
