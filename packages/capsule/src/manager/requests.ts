import { unlink } from 'node:fs/promises';
import type { Socket } from 'node:net';

import { readManagerFrames, sendEvent, sendResponse } from '../ipc/server.js';
import type {
  CapsuleManagerBootstrap,
  CapsuleManagerClientFrame,
  CapsuleManagerControlFrame,
  CapsuleManagerRequest,
} from '../protocol.js';
import { recordedError } from '../records.js';
import type {
  CapsuleExecutionControl,
  CapsuleExecutionInteraction,
  CapsuleInteractiveControl,
  CapsuleInteractiveEvent,
} from '../types.js';
import { handleExec } from './exec-request.js';
import { persist, transition, type RunningManager } from './runtime.js';

function assertNever(value: never): never {
  throw new Error(`Unhandled Capsule request: ${JSON.stringify(value)}`);
}

function isControl(frame: CapsuleManagerClientFrame): frame is CapsuleManagerControlFrame {
  return frame.kind.startsWith('exec-') && frame.kind !== 'exec-request';
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

function disconnectGracePeriod(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 250);
    timer.unref();
  });
}

async function* interactiveControls(input: {
  readonly frames: AsyncGenerator<CapsuleManagerClientFrame>;
  readonly requestId: string;
}): AsyncGenerator<CapsuleExecutionControl> {
  try {
    for await (const frame of input.frames) {
      if (!isControl(frame)) {
        throw new Error(`Unexpected ${frame.kind} after interactive execution started`);
      }
      if (frame.requestId !== input.requestId) {
        throw new Error('Interactive control request identity does not match execution');
      }
      yield decodeControl(frame);
    }
  } finally {
    yield {
      kind: 'signal',
      controlId: `${input.requestId}-transport-close-signal`,
      signal: 'SIGINT',
    };
    yield {
      kind: 'stdin-end',
      controlId: `${input.requestId}-transport-close-stdin`,
    };
    await disconnectGracePeriod();
    yield {
      kind: 'force-terminate',
      controlId: `${input.requestId}-transport-close-kill`,
    };
  }
}

function interactiveTransport(input: {
  readonly socket: Socket;
  readonly request: Extract<CapsuleManagerRequest, { readonly kind: 'interactive-exec-request' }>;
  readonly frames: AsyncGenerator<CapsuleManagerClientFrame>;
}): CapsuleExecutionInteraction {
  return {
    kind: 'interactive',
    terminal: input.request.terminal,
    controls: interactiveControls({ frames: input.frames, requestId: input.request.requestId }),
    onEvent: (event: CapsuleInteractiveEvent) => {
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
      void sendEvent(input.socket, frame).catch(() => undefined);
    },
  };
}

async function handleStop(input: {
  readonly socket: Socket;
  readonly request: Extract<CapsuleManagerRequest, { readonly kind: 'stop-request' }>;
  readonly bootstrap: CapsuleManagerBootstrap;
  readonly manager: RunningManager;
}): Promise<void> {
  input.manager.record = await persist(
    input.bootstrap.projectDirectory,
    transition(input.manager.record, 'stopping'),
  );
  try {
    await input.manager.sandbox.stop({ reason: input.request.reason });
  } catch (error) {
    input.manager.record = await persist(
      input.bootstrap.projectDirectory,
      transition(input.manager.record, 'stop-failed', {
        cleanup: { kind: 'failed', error: recordedError(error) },
        failure: { kind: 'recorded', error: recordedError(error) },
      }),
    );
    throw error;
  }
  input.manager.record = await persist(
    input.bootstrap.projectDirectory,
    transition(input.manager.record, 'stopped', { cleanup: { kind: 'complete' } }),
  );
  try {
    await sendResponse(input.socket, {
      kind: 'stop-response',
      requestId: input.request.requestId,
      cleanup: 'complete',
    });
  } finally {
    input.manager.server.close();
    await unlink(input.manager.record.socketPath).catch(() => undefined);
  }
}

async function handleConnection(
  socket: Socket,
  bootstrap: CapsuleManagerBootstrap,
  manager: RunningManager,
): Promise<void> {
  let request: CapsuleManagerRequest | undefined;
  try {
    const frames = readManagerFrames(socket);
    const first = await frames.next();
    if (first.done || isControl(first.value)) {
      throw new Error('Capsule manager connection must start with a request');
    }
    request = first.value;
    switch (request.kind) {
      case 'exec-request':
        await handleExec({
          socket,
          request,
          bootstrap,
          manager,
          interaction: { kind: 'captured' },
        });
        break;
      case 'interactive-exec-request':
        await handleExec({
          socket,
          request,
          bootstrap,
          manager,
          interaction: interactiveTransport({ socket, request, frames }),
        });
        break;
      case 'stop-request':
        await handleStop({ socket, request, bootstrap, manager });
        break;
      default:
        assertNever(request);
    }
  } catch (error) {
    await sendResponse(socket, {
      kind: 'manager-error-response',
      requestId: request === undefined ? 'unknown' : request.requestId,
      error: recordedError(error),
    }).catch(() => undefined);
  }
}

export function serveManager(bootstrap: CapsuleManagerBootstrap, manager: RunningManager): void {
  let tail = Promise.resolve();
  manager.server.on('connection', (socket) => {
    tail = tail.then(() => handleConnection(socket, bootstrap, manager));
    void tail.catch(() => {
      return undefined;
    });
  });
}
