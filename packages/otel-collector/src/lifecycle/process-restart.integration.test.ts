import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { readCollectorSession } from '../index.js';
import { traceRequest } from '../test-fixtures/collector.js';
import type { CollectorEndpoint } from '../model/types.js';

function startProcess(storageDirectory: string): {
  readonly process: ChildProcess;
  readonly ready: Promise<CollectorEndpoint>;
} {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('../../dist/main.js', import.meta.url))],
    {
      env: {
        ...process.env,
        BLACKBOX_OTEL_SESSION_ID: 'process-session',
        BLACKBOX_OTEL_EXECUTION_ID: 'process-execution',
        BLACKBOX_OTEL_STORAGE_DIRECTORY: storageDirectory,
        BLACKBOX_OTEL_HOST: '127.0.0.1',
        BLACKBOX_OTEL_PORT: '0',
        BLACKBOX_OTEL_TRACES_PATH: '/v1/traces',
        BLACKBOX_OTEL_READ_PATH: '/status',
        BLACKBOX_OTEL_MAX_REQUEST_BYTES: '4096',
        BLACKBOX_OTEL_SHUTDOWN_TIMEOUT_MS: '1000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const ready = new Promise<CollectorEndpoint>((resolve, reject) => {
    let output = '';
    let errors = '';
    const timeout = setTimeout(() => {
      reject(new Error(`No collector readiness: ${errors}`));
    }, 5000);
    child.on('error', reject);
    child.stderr.on('data', (chunk: Buffer) => {
      errors += chunk.toString();
    });
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const line = output.split('\n')[0];
      if (!output.includes('\n')) {
        return;
      }
      clearTimeout(timeout);
      const message = JSON.parse(line) as {
        readonly kind: string;
        readonly endpoint: CollectorEndpoint;
      };
      if (message.kind === 'collector-ready') {
        resolve(message.endpoint);
      }
    });
    child.once('exit', () => {
      clearTimeout(timeout);
      reject(new Error(`Collector exited: ${errors}`));
    });
  });
  return { process: child, ready };
}

async function terminate(child: ChildProcess, signal: NodeJS.Signals): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exited = once(child, 'exit');
  child.kill(signal);
  await exited;
}

it('recovers durable spans and marks a SIGKILLed receiver interrupted after a real process restart', async () => {
  const storageDirectory = await mkdtemp(join(tmpdir(), 'blackbox-collector-process-'));
  const children: ChildProcess[] = [];
  try {
    const first = startProcess(storageDirectory);
    children.push(first.process);
    const endpoint = await first.ready;
    const response = await fetch(endpoint.tracesUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(traceRequest()),
    });
    expect(response.status).toBe(200);
    await terminate(first.process, 'SIGKILL');
    const second = startProcess(storageDirectory);
    children.push(second.process);
    await second.ready;
    await terminate(second.process, 'SIGTERM');
    expect(second.process.exitCode).toBe(0);
    expect(
      await readCollectorSession({
        storageDirectory,
        sessionId: 'process-session',
        executionId: 'process-execution',
      }),
    ).toMatchObject({
      kind: 'collector-session-found',
      lifecycle: {
        telemetry: { acceptedRequests: 1, acceptedSpans: 2 },
        runs: [
          { receiver: 'interrupted', shutdown: 'interrupted' },
          { receiver: 'stopped', shutdown: 'complete' },
        ],
      },
      fragments: [{ sequence: 1, spanCount: 2 }],
    });
  } finally {
    await Promise.all(children.map((child) => terminate(child, 'SIGKILL')));
    await rm(storageDirectory, { recursive: true, force: true });
  }
});
