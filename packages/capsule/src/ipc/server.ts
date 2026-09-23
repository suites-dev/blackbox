import type { Socket } from 'node:net';

import type { CapsuleManagerRequest, CapsuleManagerResponse } from '../protocol.js';

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export async function readRequest(socket: Socket): Promise<CapsuleManagerRequest> {
  return new Promise((resolve, reject) => {
    let bytes = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      bytes += chunk;
      if (bytes.length > 1_048_576) {
        reject(new Error('Capsule manager request exceeds 1 MiB'));
        socket.destroy();
        return;
      }
      const newline = bytes.indexOf('\n');
      if (newline < 0) {
        return;
      }
      try {
        resolve(JSON.parse(bytes.slice(0, newline)) as CapsuleManagerRequest);
      } catch (error) {
        reject(asError(error));
      }
    });
    socket.once('error', reject);
    socket.once('end', () => {
      if (!bytes.includes('\n')) {
        reject(new Error('Incomplete Capsule manager request'));
      }
    });
  });
}

export function sendResponse(socket: Socket, response: CapsuleManagerResponse): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.end(`${JSON.stringify(response)}\n`, resolve);
  });
}
