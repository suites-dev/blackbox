import { unlink } from 'node:fs/promises';
import type { Socket } from 'node:net';

import { capsuleConnectionEnvironment } from '../connection-environment.js';
import { runHost, runParticipant } from '../execution/commands.js';
import { readRequest, sendResponse } from '../ipc/server.js';
import type { CapsuleManagerBootstrap, CapsuleManagerRequest } from '../protocol.js';
import { recordedError, writeCapsuleActivities } from '../records.js';
import type { CapsuleActivityReport, CapsuleProcessOutcome } from '../types.js';
import { persist, transition, type RunningManager } from './runtime.js';

function assertNever(value: never): never {
  throw new Error(`Unhandled Capsule request: ${JSON.stringify(value)}`);
}

async function executeTarget(input: {
  readonly request: Extract<CapsuleManagerRequest, { readonly kind: 'exec-request' }>;
  readonly bootstrap: CapsuleManagerBootstrap;
  readonly manager: RunningManager;
}): Promise<CapsuleProcessOutcome> {
  const { target } = input.request;
  switch (target.kind) {
    case 'host':
      return runHost({
        argv: target.argv,
        cwd: input.bootstrap.projectDirectory,
        environment: capsuleConnectionEnvironment({
          sessionId: input.bootstrap.sessionId,
          entrypoint: input.manager.entrypoint,
        }),
      });
    case 'participant': {
      const service = input.manager.participantServices.get(target.participant);
      if (service === undefined) {
        throw new Error(`Unknown participant ${JSON.stringify(target.participant)}`);
      }
      return runParticipant({ sandbox: input.manager.sandbox, service, argv: target.argv });
    }
    default:
      return assertNever(target);
  }
}

async function handleExec(input: {
  readonly socket: Socket;
  readonly request: Extract<CapsuleManagerRequest, { readonly kind: 'exec-request' }>;
  readonly bootstrap: CapsuleManagerBootstrap;
  readonly manager: RunningManager;
}): Promise<void> {
  const startedAt = new Date().toISOString();
  const outcome = await executeTarget(input);
  const target = input.request.target;
  const activity = {
    sequence: input.manager.activities.length + 1,
    target:
      target.kind === 'participant'
        ? { kind: 'participant' as const, participant: target.participant }
        : { kind: 'host' as const },
    argv: [...target.argv],
    outcome,
    startedAt,
    completedAt: new Date().toISOString(),
  } satisfies CapsuleActivityReport;
  input.manager.activities = [...input.manager.activities, activity];
  await writeCapsuleActivities({
    projectDirectory: input.bootstrap.projectDirectory,
    sessionId: input.bootstrap.sessionId,
    activities: input.manager.activities,
  });
  await sendResponse(input.socket, {
    kind: 'exec-response',
    requestId: input.request.requestId,
    outcome,
  });
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
  await sendResponse(input.socket, {
    kind: 'stop-response',
    requestId: input.request.requestId,
    cleanup: 'complete',
  });
  input.manager.server.close();
  await unlink(input.manager.record.socketPath).catch(() => undefined);
}

async function handleConnection(
  socket: Socket,
  bootstrap: CapsuleManagerBootstrap,
  manager: RunningManager,
): Promise<void> {
  let request: CapsuleManagerRequest | undefined;
  try {
    request = await readRequest(socket);
    switch (request.kind) {
      case 'exec-request':
        await handleExec({ socket, request, bootstrap, manager });
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
  manager.server.on('connection', (socket) => {
    void handleConnection(socket, bootstrap, manager);
  });
}
