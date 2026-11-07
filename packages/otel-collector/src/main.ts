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

function redactionEnvironment():
  { readonly kind: 'credentials-v1'; readonly secrets: readonly string[] } | undefined {
  const raw = process.env.BLACKBOX_OTEL_REDACTION_SECRETS;
  const policy = process.env.BLACKBOX_OTEL_REDACTION_POLICY;
  if (raw === undefined && policy === undefined) {
    return undefined;
  }
  if (raw === undefined || policy !== 'credentials-v1') {
    throw new Error('Invalid collector redaction configuration.');
  }
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('Invalid collector redaction configuration.');
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error('Invalid collector redaction configuration.');
  }
  return { kind: 'credentials-v1', secrets: value as string[] };
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
      kind: 'split-bearer-tokens',
      ingestToken: requiredEnvironment('BLACKBOX_OTEL_INGEST_TOKEN'),
      controlToken: requiredEnvironment('BLACKBOX_OTEL_CONTROL_TOKEN'),
    },
    redaction: redactionEnvironment(),
    limits: {
      maxRequestBytes: integerEnvironment('BLACKBOX_OTEL_MAX_REQUEST_BYTES'),
      maxRetainedBytes: integerEnvironment('BLACKBOX_OTEL_MAX_RETAINED_BYTES'),
      maxRetainedFragments: integerEnvironment('BLACKBOX_OTEL_MAX_RETAINED_FRAGMENTS'),
      shutdownTimeoutMs: integerEnvironment('BLACKBOX_OTEL_SHUTDOWN_TIMEOUT_MS'),
    },
  });
  const stopped = new Promise<void>((resolve) => {
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
  process.stdout.write(
    `${JSON.stringify({ kind: 'collector-ready', endpoint: collector.endpoint, status: collector.status() })}\n`,
  );
  await stopped;
}

run().catch((error: unknown) => {
  const message = error instanceof Error && error.message !== '' ? error.message : String(error);
  process.stderr.write(
    `${JSON.stringify({ kind: 'collector-start-failed', error: { name: 'Error', message } })}\n`,
  );
  process.exitCode = 1;
});
