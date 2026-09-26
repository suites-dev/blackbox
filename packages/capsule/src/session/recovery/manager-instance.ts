import { randomUUID } from 'node:crypto';
import { connect, type Socket } from 'node:net';

import { readJsonLines, writeJsonLine } from '../../ipc/streaming/json-lines.js';

export type ManagerInstanceProbe =
  | { readonly kind: 'manager-instance-exact' }
  | { readonly kind: 'manager-instance-different' }
  | { readonly kind: 'manager-socket-missing' }
  | { readonly kind: 'manager-instance-unavailable' };

function unavailable(error: unknown): ManagerInstanceProbe {
  if (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ECONNREFUSED')
  ) {
    return { kind: 'manager-socket-missing' };
  }
  return { kind: 'manager-instance-unavailable' };
}

async function exchange(input: {
  readonly socket: Socket;
  readonly requestId: string;
  readonly instanceId: string;
}): Promise<ManagerInstanceProbe> {
  await writeJsonLine(input.socket, {
    kind: 'manager-identity-request',
    requestId: input.requestId,
  });
  const frames = readJsonLines({
    socket: input.socket,
    maximumFrameBytes: 65_536,
    incompleteMessage: 'Incomplete Capsule manager identity response',
    oversizedMessage: 'Capsule manager identity response exceeds 64 KiB',
  });
  const first = await frames.next();
  if (first.done) {
    return { kind: 'manager-socket-missing' };
  }
  if (typeof first.value !== 'object' || first.value === null) {
    return { kind: 'manager-instance-unavailable' };
  }
  const response = first.value as Record<string, unknown>;
  if (
    response.kind !== 'manager-identity-response' ||
    response.requestId !== input.requestId ||
    typeof response.instanceId !== 'string'
  ) {
    return { kind: 'manager-instance-unavailable' };
  }
  return response.instanceId === input.instanceId
    ? { kind: 'manager-instance-exact' }
    : { kind: 'manager-instance-different' };
}

export function probeManagerInstance(input: {
  readonly socketPath: string;
  readonly instanceId: string;
}): Promise<ManagerInstanceProbe> {
  const socket = connect(input.socketPath);
  const requestId = randomUUID();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ManagerInstanceProbe): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => {
      finish({ kind: 'manager-instance-unavailable' });
    }, 250);
    timer.unref();
    socket.once('error', (error) => {
      finish(unavailable(error));
    });
    socket.once('connect', () => {
      void exchange({ socket, requestId, instanceId: input.instanceId }).then(
        finish,
        (error: unknown) => {
          finish(unavailable(error));
        },
      );
    });
  });
}
