import type { Socket } from 'node:net';

import type {
  CapsuleManagerClientFrame,
  CapsuleManagerResponse,
  CapsuleManagerServerFrame,
} from '../protocol.js';
import { endWithJsonLine, readJsonLines, writeJsonLine } from './streaming/json-lines.js';

export function readManagerFrames(socket: Socket): AsyncGenerator<CapsuleManagerClientFrame> {
  return readJsonLines({
    socket,
    maximumFrameBytes: 1_048_576,
    incompleteMessage: 'Incomplete Capsule manager request',
    oversizedMessage: 'Capsule manager request exceeds 1 MiB',
  }) as AsyncGenerator<CapsuleManagerClientFrame>;
}

export async function readRequest(socket: Socket): Promise<CapsuleManagerClientFrame> {
  const first = await readManagerFrames(socket).next();
  if (first.done) {
    throw new Error('Incomplete Capsule manager request');
  }
  return first.value;
}

export function sendEvent(socket: Socket, event: CapsuleManagerServerFrame): Promise<void> {
  return writeJsonLine(socket, event);
}

export function sendResponse(socket: Socket, response: CapsuleManagerResponse): Promise<void> {
  return endWithJsonLine(socket, response);
}
