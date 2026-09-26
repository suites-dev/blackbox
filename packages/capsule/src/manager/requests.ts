import { unlink } from 'node:fs/promises';
import type { Socket } from 'node:net';

import { readManagerFrames, sendResponse } from '../ipc/server.js';
import type {
  CapsuleManagerBootstrap,
  CapsuleManagerClientFrame,
  CapsuleManagerControlFrame,
  CapsuleManagerRequest,
} from '../protocol.js';
import { recordedError } from '../records.js';
import { handleExec } from './exec-request.js';
import { ManagerExecutionCoordinator } from './transport/execution.js';
import { persist, transition, type RunningManager } from './runtime.js';

function assertNever(value: never): never {
  throw new Error(`Unhandled Capsule request: ${JSON.stringify(value)}`);
}

function isControl(frame: CapsuleManagerClientFrame): frame is CapsuleManagerControlFrame {
  return frame.kind.startsWith('exec-') && frame.kind !== 'exec-request';
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

interface AdmittedConnection {
  readonly socket: Socket;
  readonly frames: AsyncGenerator<CapsuleManagerClientFrame>;
  readonly request: CapsuleManagerRequest;
}

async function admitConnection(socket: Socket): Promise<AdmittedConnection> {
  const frames = readManagerFrames(socket);
  const first = await frames.next();
  if (first.done || isControl(first.value)) {
    throw new Error('Capsule manager connection must start with a request');
  }
  return { socket, frames, request: first.value };
}

async function executeRequest(input: {
  readonly connection: AdmittedConnection;
  readonly bootstrap: CapsuleManagerBootstrap;
  readonly manager: RunningManager;
  readonly executions: ManagerExecutionCoordinator;
}): Promise<void> {
  const { socket, request, frames } = input.connection;
  try {
    switch (request.kind) {
      case 'exec-request':
      case 'interactive-exec-request': {
        const execution = input.executions.begin({ socket, request, frames });
        try {
          await handleExec({
            socket,
            request,
            bootstrap: input.bootstrap,
            manager: input.manager,
            interaction: execution.interaction,
          });
        } finally {
          execution.release();
        }
        break;
      }
      case 'stop-request':
        await handleStop({ socket, request, bootstrap: input.bootstrap, manager: input.manager });
        break;
      default:
        assertNever(request);
    }
  } catch (error) {
    await sendResponse(socket, {
      kind: 'manager-error-response',
      requestId: request.requestId,
      error: recordedError(error),
    }).catch(() => undefined);
  }
}

export function serveManager(bootstrap: CapsuleManagerBootstrap, manager: RunningManager): void {
  let tail = Promise.resolve();
  const executions = new ManagerExecutionCoordinator();
  manager.server.on('connection', (socket) => {
    void admitConnection(socket)
      .then((connection) => {
        if (connection.request.kind === 'stop-request') {
          executions.requestStop();
        }
        tail = tail.then(() => executeRequest({ connection, bootstrap, manager, executions }));
        void tail.catch(() => undefined);
      })
      .catch(async (error: unknown) => {
        await sendResponse(socket, {
          kind: 'manager-error-response',
          requestId: 'unknown',
          error: recordedError(error),
        }).catch(() => undefined);
      });
  });
}
