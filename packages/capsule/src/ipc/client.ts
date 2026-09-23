import { connect } from 'node:net';

import type { CapsuleManagerRequest, CapsuleManagerResponse } from '../protocol.js';

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export async function managerRequest(input: {
  readonly socketPath: string;
  readonly request: CapsuleManagerRequest;
}): Promise<CapsuleManagerResponse> {
  return new Promise((resolve, reject) => {
    const socket = connect(input.socketPath);
    let bytes = '';
    socket.setEncoding('utf8');
    socket.setTimeout(120_000, () =>
      socket.destroy(new Error('Capsule manager request timed out')),
    );
    socket.once('connect', () => socket.write(`${JSON.stringify(input.request)}\n`));
    socket.on('data', (chunk: string) => {
      bytes += chunk;
      if (bytes.length > 16_777_216) {
        socket.destroy(new Error('Capsule manager response exceeds 16 MiB'));
        return;
      }
      const newline = bytes.indexOf('\n');
      if (newline < 0) {
        return;
      }
      try {
        resolve(JSON.parse(bytes.slice(0, newline)) as CapsuleManagerResponse);
        socket.destroy();
      } catch (error) {
        reject(asError(error));
      }
    });
    socket.once('error', reject);
    socket.once('end', () => {
      if (!bytes.includes('\n')) {
        reject(new Error('Incomplete Capsule manager response'));
      }
    });
  });
}
