import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';
import { readCollectorSession } from '@suites/blackbox-otel-collector';
import { sandboxTelemetryStorageDirectory } from '@suites/blackbox-sandbox';

import { reportObservations } from './observations.js';

function attemptFixture(root: string, identity: { sessionId: string; executionId: string }) {
  const read = vi.fn(() => Promise.reject(new Error('Full telemetry read is forbidden')));
  return {
    sandbox: {
      sandboxId: identity.executionId,
      executionId: identity.executionId,
      artifactDirectory: root,
      catalogEntry: { kind: 'system' as const, id: 'orders' },
      projectName: 'orders',
      entrypoint: { url: 'http://127.0.0.1:1', host: '127.0.0.1', port: 1, protocol: 'http' },
      containers: new Map(),
    },
    telemetry: {
      ...identity,
      read,
      readTrace: read,
      inspect: () => Promise.resolve({ kind: 'disabled' as const }),
    },
  };
}

it('reports retained counters without reading fragments and diagnoses missing or corrupt lifecycle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blackbox-observations-'));
  const identity = { sessionId: 'session', executionId: 'execution' };
  const storageDirectory = sandboxTelemetryStorageDirectory({
    recordDirectory: root,
    sandboxId: identity.executionId,
  });
  const session = join(storageDirectory, identity.sessionId, identity.executionId);
  const attempt = attemptFixture(root, identity);
  const emit = vi.fn();
  const progress = { emit, protect: () => undefined, identify: () => undefined };
  try {
    await reportObservations(progress, attempt);
    expect(emit).toHaveBeenLastCalledWith('observations', 'info', 'collector-lifecycle-missing');
    await mkdir(join(session, 'fragments'), { recursive: true });
    await writeFile(
      join(session, 'collector-lifecycle.json'),
      JSON.stringify({
        schemaVersion: 1,
        ...identity,
        revision: 1,
        runs: [
          {
            instanceId: 'collector',
            startedAt: '2026-10-01T00:00:00Z',
            updatedAt: '2026-10-01T00:00:01Z',
            stoppedAt: '2026-10-01T00:00:01Z',
            receiver: 'stopped',
            shutdown: 'complete',
            failure: null,
            instrumentation: { kind: 'not-activated' },
            endpoint: {
              kind: 'http',
              host: '127.0.0.1',
              port: 1,
              baseUrl: 'http://127.0.0.1:1',
              tracesPath: '/v1/traces',
              tracesUrl: 'http://127.0.0.1:1/v1/traces',
              activationPath: '/v1/activation',
              activationUrl: 'http://127.0.0.1:1/v1/activation',
              readinessPath: '/ready',
              readinessUrl: 'http://127.0.0.1:1/ready',
              readPath: '/v1/collector',
              readUrl: 'http://127.0.0.1:1/v1/collector',
            },
          },
        ],
        telemetry: {
          status: 'received',
          acceptedRequests: 2,
          acceptedSpans: 7,
          lastReceivedAt: new Date().toISOString(),
        },
      }),
    );
    await writeFile(join(session, 'fragments/000000000001.json'), '{}');
    expect((await readCollectorSession({ ...identity, storageDirectory })).kind).toBe(
      'collector-session-corrupt',
    );
    await reportObservations(progress, attempt);
    expect(emit).toHaveBeenCalledWith('observations', 'info', '2 requests; 7 spans');
    expect(emit).toHaveBeenLastCalledWith('collector', 'completed', 'shutdown complete');
    expect(attempt.telemetry.read).not.toHaveBeenCalled();
    await writeFile(join(session, 'collector-lifecycle.json'), '{}');
    await reportObservations(progress, attempt);
    expect(emit).toHaveBeenLastCalledWith('observations', 'info', 'collector-lifecycle-corrupt');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
