import type { Socket } from 'node:net';

function parse(line: Buffer): unknown {
  return JSON.parse(line.toString('utf8')) as unknown;
}

export async function* readJsonLines(input: {
  readonly socket: Socket;
  readonly maximumFrameBytes: number;
  readonly incompleteMessage: string;
  readonly oversizedMessage: string;
}): AsyncGenerator {
  let buffered = Buffer.alloc(0);
  for await (const value of input.socket) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
    buffered = Buffer.concat([buffered, chunk]);
    let newline = buffered.indexOf(0x0a);
    while (newline >= 0) {
      if (newline > input.maximumFrameBytes) {
        throw new Error(input.oversizedMessage);
      }
      yield parse(buffered.subarray(0, newline));
      buffered = buffered.subarray(newline + 1);
      newline = buffered.indexOf(0x0a);
    }
    if (buffered.byteLength > input.maximumFrameBytes) {
      throw new Error(input.oversizedMessage);
    }
  }
  if (buffered.byteLength > 0) {
    throw new Error(input.incompleteMessage);
  }
}

export function writeJsonLine(socket: Socket, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.write(`${JSON.stringify(value)}\n`, (error) => {
      if (error === null || error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}

export function endWithJsonLine(socket: Socket, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.end(`${JSON.stringify(value)}\n`, resolve);
  });
}
