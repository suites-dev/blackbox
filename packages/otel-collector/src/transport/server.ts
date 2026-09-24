import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type {
  CollectorCloseResult,
  CollectorEndpoint,
  CollectorHandle,
  StartCollectorInput,
} from '../model/types.js';
import { type CollectorStore, createCollectorStore } from '../lifecycle/store.js';
import { acquireStorageLease, type CollectorStorageLease } from '../storage/lease.js';
import { handleCollectorRequest } from './http-handler.js';
import { recordedFailure, validateStartInput } from '../model/validation.js';

function listen(input: {
  readonly server: Server;
  readonly host: string;
  readonly port: number;
}): Promise<number> {
  return new Promise((resolve, reject) => {
    input.server.once('error', reject);
    input.server.listen(input.port, input.host, () => {
      input.server.off('error', reject);
      const address = input.server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Collector did not acquire a TCP port.'));
      } else {
        resolve(address.port);
      }
    });
  });
}

function endpoint(input: StartCollectorInput, port: number): CollectorEndpoint {
  const host = input.endpoint.host.includes(':') ? `[${input.endpoint.host}]` : input.endpoint.host;
  const baseUrl = `http://${host}:${String(port)}`;
  return {
    kind: 'http',
    host: input.endpoint.host,
    port,
    baseUrl,
    tracesPath: input.endpoint.tracesPath,
    tracesUrl: `${baseUrl}${input.endpoint.tracesPath}`,
    activationPath: input.endpoint.activationPath,
    activationUrl: `${baseUrl}${input.endpoint.activationPath}`,
    readinessPath: input.endpoint.readinessPath,
    readinessUrl: `${baseUrl}${input.endpoint.readinessPath}`,
    readPath: input.endpoint.readPath,
    readUrl: `${baseUrl}${input.endpoint.readPath}`,
  };
}

function stopListening(input: {
  readonly server: Server;
  readonly timeoutMs: number;
}): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (timedOut: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(timedOut);
    };
    const timer = setTimeout(() => {
      input.server.closeAllConnections();
      finish(true);
    }, input.timeoutMs);
    timer.unref();
    input.server.close(() => {
      finish(false);
    });
    input.server.closeIdleConnections();
  });
}

function closeCollector(input: {
  readonly server: Server;
  readonly store: CollectorStore;
  readonly lease: CollectorStorageLease;
  readonly timeoutMs: number;
}): () => Promise<CollectorCloseResult> {
  let closing: Promise<CollectorCloseResult> | null = null;
  return () => {
    if (closing !== null) {
      return closing.then((result) =>
        result.kind === 'collector-stopped' ? { ...result, alreadyStopped: true } : result,
      );
    }
    closing = (async () => {
      let failure: ReturnType<typeof recordedFailure> | null = null;
      try {
        await input.store.beginDrain();
      } catch (error) {
        failure = recordedFailure(error);
      }
      failure ??= input.store.status().failure;
      const timedOut = await stopListening({ server: input.server, timeoutMs: input.timeoutMs });
      if (timedOut) {
        failure = {
          name: 'CollectorShutdownTimeout',
          message: `Collector did not drain within ${String(input.timeoutMs)}ms.`,
        };
      }
      try {
        await input.store.finish({ timedOut, failure });
      } catch (error) {
        failure = recordedFailure(error);
      }
      try {
        await input.lease.release();
      } catch (error) {
        failure = recordedFailure(error);
      }
      const status = input.store.status();
      return failure === null
        ? { kind: 'collector-stopped', status, alreadyStopped: false }
        : { kind: 'collector-stop-failed', status, error: failure };
    })();
    return closing;
  };
}

async function abandonStartup(input: {
  readonly server: Server;
  readonly lease: CollectorStorageLease;
}): Promise<void> {
  await new Promise<void>((resolve) =>
    input.server.close(() => {
      resolve();
    }),
  );
  await input.lease.release();
}

export async function startCollector(input: StartCollectorInput): Promise<CollectorHandle> {
  validateStartInput(input);
  const lease = await acquireStorageLease(input);
  let store: CollectorStore | null = null;
  const server = createServer((request, response) => {
    void handleCollectorRequest({ request, response, config: input, store }).catch(() =>
      response.destroy(),
    );
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 1000;
  let port: number;
  try {
    port = await listen({ server, host: input.endpoint.host, port: input.endpoint.port });
  } catch (error) {
    await lease.release();
    throw error;
  }
  const actualEndpoint = endpoint(input, port);
  try {
    store = await createCollectorStore({
      lease,
      endpoint: actualEndpoint,
      instanceId: randomUUID(),
    });
  } catch (error) {
    await abandonStartup({ server, lease });
    throw error;
  }
  return {
    kind: 'collector',
    sessionId: input.sessionId,
    executionId: input.executionId,
    endpoint: actualEndpoint,
    status: () => store.status(),
    close: closeCollector({ server, store, lease, timeoutMs: input.limits.shutdownTimeoutMs }),
  };
}
