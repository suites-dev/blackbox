import type { Socket } from 'node:net';

import type {
  CapsuleManagerClientFrame,
  CapsuleManagerResponse,
  CapsuleManagerServerFrame,
} from '../protocol.js';
import { endWithJsonLine, readJsonLines, writeJsonLine } from './streaming/json-lines.js';

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Capsule manager request must be an object');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Capsule manager request ${field} must be a non-empty string`);
  }
}

function target(value: unknown): void {
  const item = record(value);
  text(item.kind, 'target.kind');
  if (item.kind === 'driver') {
    text(item.driverId, 'target.driverId');
    const untraced = record(item.untraced);
    text(untraced.kind, 'target.untraced.kind');
    if (untraced.kind !== 'allow' && untraced.kind !== 'refuse') {
      throw new Error('Capsule manager request target.untraced.kind is unsupported');
    }
  } else if (item.kind !== 'host') {
    throw new Error('Capsule manager request target.kind is unsupported');
  }
  if (
    !Array.isArray(item.argv) ||
    item.argv.length === 0 ||
    !item.argv.every((value) => typeof value === 'string')
  ) {
    throw new Error('Capsule manager request target.argv must be a non-empty string array');
  }
}

function terminal(value: unknown): void {
  const item = record(value);
  const columns = item.columns;
  const rows = item.rows;
  if (
    typeof columns !== 'number' ||
    typeof rows !== 'number' ||
    !Number.isInteger(columns) ||
    !Number.isInteger(rows) ||
    columns <= 0 ||
    rows <= 0
  ) {
    throw new Error('Capsule manager request terminal must contain positive integer dimensions');
  }
}

function validateFrame(value: unknown): CapsuleManagerClientFrame {
  const item = record(value);
  text(item.kind, 'kind');
  text(item.requestId, 'requestId');
  switch (item.kind) {
    case 'exec-request':
    case 'interactive-exec-request': {
      const name = record(item.name);
      if (name.kind !== 'omitted' && name.kind !== 'provided') {
        throw new Error('Capsule manager request name.kind is unsupported');
      }
      if (name.kind === 'provided') {
        text(name.value, 'name.value');
      }
      if (item.purpose !== 'setup' && item.purpose !== 'stimulus' && item.purpose !== 'inspection') {
        throw new Error('Capsule manager request purpose is unsupported');
      }
      target(item.target);
      if (item.kind === 'interactive-exec-request') {
        terminal(item.terminal);
      }
      return item as CapsuleManagerClientFrame;
    }
    case 'stop-request':
      if (
        item.reason !== 'completed' &&
        item.reason !== 'cancelled' &&
        item.reason !== 'failed' &&
        item.reason !== 'interrupted'
      ) {
        throw new Error('Capsule manager request reason is unsupported');
      }
      return item as CapsuleManagerClientFrame;
    case 'manager-identity-request':
      return item as CapsuleManagerClientFrame;
    case 'exec-stdin-chunk':
      text(item.controlId, 'controlId');
      if (typeof item.chunk !== 'string') {
        throw new Error('Capsule manager request chunk must be a string');
      }
      return item as CapsuleManagerClientFrame;
    case 'exec-stdin-end':
      text(item.controlId, 'controlId');
      return item as CapsuleManagerClientFrame;
    case 'exec-resize':
      text(item.controlId, 'controlId');
      terminal(item.terminal);
      return item as CapsuleManagerClientFrame;
    case 'exec-signal':
      text(item.controlId, 'controlId');
      if (item.signal !== 'SIGINT' && item.signal !== 'SIGQUIT') {
        throw new Error('Capsule manager request signal is unsupported');
      }
      return item as CapsuleManagerClientFrame;
    default:
      throw new Error('Capsule manager request kind is unsupported');
  }
}

export function readManagerFrames(socket: Socket): AsyncGenerator<CapsuleManagerClientFrame> {
  return (async function* (): AsyncGenerator<CapsuleManagerClientFrame> {
    for await (const value of readJsonLines({
      socket,
      maximumFrameBytes: 1_048_576,
      incompleteMessage: 'Incomplete Capsule manager request',
      oversizedMessage: 'Capsule manager request exceeds 1 MiB',
    })) {
      yield validateFrame(value);
    }
  })();
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
