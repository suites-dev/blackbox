import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';

import type { CollectorEndpoint, CollectorLifecycleRecord } from '../model/types.js';
import type { CollectorStorageLease } from '../storage/lease.js';
import { fragmentDirectory, sessionDirectory } from '../storage/paths.js';
import { RunningCollectorStore } from './running-store.js';

test('audit M2: rejects telemetry after collector failure', async () => {
  const storageDirectory = await mkdtemp(join(tmpdir(), 'blackbox-running-store-audit-'));
  const lease = {
    sessionId: 'audit-session',
    executionId: 'audit-execution',
    storageDirectory,
    token: 'audit-token',
    assertOwned: () => Promise.resolve(),
    release: () => Promise.resolve(),
  } satisfies CollectorStorageLease;
  const endpoint = {
    kind: 'http',
    host: '127.0.0.1',
    port: 0,
    baseUrl: 'http://127.0.0.1:0',
    tracesPath: '/v1/traces',
    tracesUrl: 'http://127.0.0.1:0/v1/traces',
    activationPath: '/v1/activation',
    activationUrl: 'http://127.0.0.1:0/v1/activation',
    readinessPath: '/ready',
    readinessUrl: 'http://127.0.0.1:0/ready',
    readPath: '/status',
    readUrl: 'http://127.0.0.1:0/status',
  } satisfies CollectorEndpoint;
  const record = {
    schemaVersion: 1,
    sessionId: lease.sessionId,
    executionId: lease.executionId,
    revision: 1,
    runs: [
      {
        instanceId: 'audit-instance',
        startedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        stoppedAt: null,
        receiver: 'ready',
        instrumentation: { kind: 'not-activated' },
        shutdown: 'not-started',
        failure: null,
        endpoint,
      },
    ],
    telemetry: {
      status: 'not-received',
      acceptedRequests: 0,
      acceptedSpans: 0,
      lastReceivedAt: null,
    },
  } satisfies CollectorLifecycleRecord;
  await mkdir(fragmentDirectory(lease), { recursive: true });
  await mkdir(sessionDirectory(lease), { recursive: true });
  const store = new RunningCollectorStore({
    lease,
    record,
    sequence: 1,
    usage: { retainedBytes: 0, retainedFragments: 0 },
    limits: { maxRetainedBytes: 4096, maxRetainedFragments: 4 },
  });

  try {
    await store.initialize();
    await store.fail(new Error('audit failure'));
    await expect(
      store.accept({ rawJson: '{}', contentEncoding: 'identity', spanCount: 0 }),
    ).rejects.toThrow('telemetry intake is stopped');
    expect(await readdir(fragmentDirectory(lease))).toEqual([]);
    expect(store.status().telemetry).toEqual({
      status: 'not-received',
      acceptedRequests: 0,
      acceptedSpans: 0,
      lastReceivedAt: null,
    });
    expect(store.status().failure).toEqual({ name: 'Error', message: 'audit failure' });
  } finally {
    await rm(storageDirectory, { recursive: true, force: true });
  }
});
