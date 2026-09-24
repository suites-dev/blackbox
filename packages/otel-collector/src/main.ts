#!/usr/bin/env node
import { startCollector } from './transport/server.js';

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function integerEnvironment(name: string): number {
  const raw = requiredEnvironment(name);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be an integer.`);
  }
  return value;
}

async function run(): Promise<void> {
  const collector = await startCollector({
    kind: 'start-collector',
    sessionId: requiredEnvironment('BLACKBOX_OTEL_SESSION_ID'),
    executionId: requiredEnvironment('BLACKBOX_OTEL_EXECUTION_ID'),
    storageDirectory: requiredEnvironment('BLACKBOX_OTEL_STORAGE_DIRECTORY'),
    endpoint: {
      kind: 'http',
      host: requiredEnvironment('BLACKBOX_OTEL_HOST'),
      port: integerEnvironment('BLACKBOX_OTEL_PORT'),
      tracesPath: requiredEnvironment('BLACKBOX_OTEL_TRACES_PATH'),
      activationPath: requiredEnvironment('BLACKBOX_OTEL_ACTIVATION_PATH'),
      readinessPath: requiredEnvironment('BLACKBOX_OTEL_READINESS_PATH'),
      readPath: requiredEnvironment('BLACKBOX_OTEL_READ_PATH'),
    },
    authorization: {
      kind: 'bearer-token',
      token: requiredEnvironment('BLACKBOX_OTEL_AUTH_TOKEN'),
    },
    limits: {
      maxRequestBytes: integerEnvironment('BLACKBOX_OTEL_MAX_REQUEST_BYTES'),
      shutdownTimeoutMs: integerEnvironment('BLACKBOX_OTEL_SHUTDOWN_TIMEOUT_MS'),
    },
  });
  process.stdout.write(
    `${JSON.stringify({ kind: 'collector-ready', endpoint: collector.endpoint, status: collector.status() })}\n`,
  );
  await new Promise<void>((resolve) => {
    let stopping = false;
    const stop = (): void => {
      if (stopping) {
        return;
      }
      stopping = true;
      void collector.close().then((result) => {
        process.stdout.write(`${JSON.stringify(result)}\n`);
        if (result.kind === 'collector-stop-failed') {
          process.exitCode = 1;
        }
        resolve();
      });
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

run().catch((error: unknown) => {
  const message = error instanceof Error && error.message !== '' ? error.message : String(error);
  process.stderr.write(
    `${JSON.stringify({ kind: 'collector-start-failed', error: { name: 'Error', message } })}\n`,
  );
  process.exitCode = 1;
});
