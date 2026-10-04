import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

import type {
  BlackboxAttemptInput,
  BlackboxAttemptRuntime,
  RunningBlackboxAttempt,
} from '../../runtime/acquisition.js';

export const eventMarker = 'BLACKBOX_SYSTEM_SANDBOX_EVENT ';

export function record(event: Readonly<Record<string, unknown>>): void {
  process.stdout.write(
    `${eventMarker}${JSON.stringify({ ...event, pid: process.pid, at: Date.now() })}\n`,
  );
}

export async function startRespondingAttempt(
  input: BlackboxAttemptInput,
): Promise<RunningBlackboxAttempt> {
  if (input.selection.kind === 'unselected') {
    throw new Error('System sandbox test did not select a catalog entry');
  }

  const executionId = randomUUID();
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        executionId,
        method: request.method,
        path: request.url,
      }),
    );
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Synthetic loopback server did not expose a TCP address');
  }
  const url = `http://127.0.0.1:${address.port}`;

  record({
    kind: 'start',
    executionId,
    selection: input.selection,
    environment: input.environment,
    configFile: input.configFile,
    artifactDirectory: input.artifactDirectory,
    url,
  });

  return {
    sandbox: {
      sandboxId: executionId,
      executionId,
      catalogEntry: input.selection,
      projectName: `blackbox-${executionId}`,
      artifactDirectory: input.artifactDirectory,
      entrypoint: {
        url,
        host: '127.0.0.1',
        port: address.port,
        protocol: 'http',
      },
      containers: new Map(),
    },
    telemetry: {
      sessionId: `session-${executionId}`,
      executionId,
      inspect: () => Promise.resolve({ kind: 'disabled' as const }),
      read: () => Promise.reject(new Error('Telemetry is not used by this native-runner fixture')),
      readTrace: () =>
        Promise.reject(new Error('Telemetry traces are not used by this native-runner fixture')),
    },
    runActivity: () => Promise.reject(new Error('not used by this fixture')),
    effects: {
      sessionId: `session-${executionId}`,
      executionId,
    },
    async stop(reason) {
      record({ kind: 'stop', executionId, reason });
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error === undefined) {
            resolveClose();
          } else {
            rejectClose(error);
          }
        });
      });
    },
  };
}

export const systemSandboxRuntime = {
  start: startRespondingAttempt,
} satisfies BlackboxAttemptRuntime;
