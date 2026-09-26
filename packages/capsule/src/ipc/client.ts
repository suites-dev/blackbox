import { once } from 'node:events';
import { connect, type Socket } from 'node:net';

import type { CapsuleInteractiveControl, CapsuleInteractiveEvent } from '../types.js';
import type {
  CapsuleManagerClientFrame,
  CapsuleManagerRequest,
  CapsuleManagerResponse,
  CapsuleManagerServerFrame,
} from '../protocol.js';
import { readJsonLines, writeJsonLine } from './streaming/json-lines.js';

function responseFrames(socket: Socket): AsyncGenerator<CapsuleManagerServerFrame> {
  return readJsonLines({
    socket,
    maximumFrameBytes: 16_777_216,
    incompleteMessage: 'Incomplete Capsule manager response',
    oversizedMessage: 'Capsule manager response exceeds 16 MiB',
  }) as AsyncGenerator<CapsuleManagerServerFrame>;
}

async function connectedSocket(socketPath: string): Promise<Socket> {
  const socket = connect(socketPath);
  await once(socket, 'connect');
  return socket;
}

export async function managerRequest(input: {
  readonly socketPath: string;
  readonly request: Exclude<CapsuleManagerRequest, { readonly kind: 'interactive-exec-request' }>;
}): Promise<CapsuleManagerResponse> {
  const socket = await connectedSocket(input.socketPath);
  try {
    // Captured execution and teardown own no cancellation protocol. Disconnecting
    // on an arbitrary deadline would abandon manager-owned work without a verdict.
    await writeJsonLine(socket, input.request);
    const first = await responseFrames(socket).next();
    if (first.done) {
      throw new Error('Incomplete Capsule manager response');
    }
    if (first.value.kind === 'exec-output' || first.value.kind === 'exec-control-result') {
      throw new Error(`Unexpected manager event for captured request: ${first.value.kind}`);
    }
    return first.value;
  } finally {
    socket.destroy();
  }
}

function controlFrame(
  requestId: string,
  control: CapsuleInteractiveControl,
): CapsuleManagerClientFrame {
  switch (control.kind) {
    case 'stdin-chunk':
      return {
        kind: 'exec-stdin-chunk',
        requestId,
        controlId: control.controlId,
        chunk: Buffer.from(control.chunk).toString('base64'),
      };
    case 'stdin-end':
      return { kind: 'exec-stdin-end', requestId, controlId: control.controlId };
    case 'resize':
      return {
        kind: 'exec-resize',
        requestId,
        controlId: control.controlId,
        terminal: control.size,
      };
    case 'signal':
      return {
        kind: 'exec-signal',
        requestId,
        controlId: control.controlId,
        signal: control.signal,
      };
  }
}

async function forwardControls(input: {
  readonly socket: Socket;
  readonly requestId: string;
  readonly controls: AsyncIterable<CapsuleInteractiveControl>;
}): Promise<void> {
  for await (const control of input.controls) {
    await writeJsonLine(input.socket, controlFrame(input.requestId, control));
  }
}

function interactiveEvent(frame: CapsuleManagerServerFrame): CapsuleInteractiveEvent | null {
  if (frame.kind === 'exec-output') {
    return {
      kind: 'output',
      stream: frame.stream,
      chunk: Buffer.from(frame.chunk, 'base64'),
    };
  }
  if (frame.kind === 'exec-control-result') {
    return {
      kind: 'control-result',
      controlId: frame.controlId,
      result: frame.result,
    };
  }
  return null;
}

function isResponse(frame: CapsuleManagerServerFrame): frame is CapsuleManagerResponse {
  return frame.kind !== 'exec-output' && frame.kind !== 'exec-control-result';
}

export async function managerInteractiveRequest(input: {
  readonly socketPath: string;
  readonly request: Extract<CapsuleManagerRequest, { readonly kind: 'interactive-exec-request' }>;
  readonly controls: AsyncIterable<CapsuleInteractiveControl>;
  readonly onEvent: (event: CapsuleInteractiveEvent) => Promise<void>;
}): Promise<CapsuleManagerResponse> {
  const socket = await connectedSocket(input.socketPath);
  try {
    await writeJsonLine(socket, input.request);
    void forwardControls({
      socket,
      requestId: input.request.requestId,
      controls: input.controls,
    }).catch((error: unknown) =>
      socket.destroy(error instanceof Error ? error : new Error(String(error))),
    );
    for await (const frame of responseFrames(socket)) {
      const event = interactiveEvent(frame);
      if (event !== null) {
        await input.onEvent(event);
        continue;
      }
      if (isResponse(frame)) {
        return frame;
      }
    }
    throw new Error('Incomplete Capsule manager response');
  } finally {
    socket.destroy();
  }
}
