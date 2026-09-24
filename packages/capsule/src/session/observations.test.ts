import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startCollector, type CollectorHandle } from '@suites/blackbox-otel-collector-internal';
import { sandboxTelemetryStorageDirectory } from '@suites/blackbox-sandbox-internal';
import { afterEach, expect, it } from 'vitest';

import {
  admitCapsuleRecord,
  capsuleSandboxRecordDirectory,
  capsuleSessionDirectory,
  type CapsuleSessionRecord,
} from '../records.js';
import { readCapsuleObservations } from './observations.js';

const roots: string[] = [];
const collectors: CollectorHandle[] = [];
const traceId = '11111111111111111111111111111111';

async function sessionFixture(sessionId: string) {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'capsule-observations-'));
  roots.push(projectDirectory);
  await writeFile(join(projectDirectory, 'blackbox.config.yaml'), 'schemaVersion: 1\n');
  const executionId = '00000000-0000-4000-8000-000000000001';
  const at = '2026-09-24T10:00:00.000Z';
  const record = {
    schemaVersion: 1,
    sessionId,
    executionId,
    system: 'orders',
    title: 'Orders experiment',
    description: { kind: 'omitted' },
    state: 'stopped',
    revision: 1,
    admittedAt: at,
    updatedAt: at,
    manager: { kind: 'not-started' },
    socketPath: join(projectDirectory, 'manager.sock'),
    entrypoint: { kind: 'unavailable' },
    containers: [],
    cleanup: { kind: 'complete' },
    failure: { kind: 'none' },
    composeProject: { kind: 'unavailable' },
    artifactRoot: capsuleSessionDirectory({ projectDirectory, sessionId }),
    networks: [],
    volumes: [],
    readiness: { kind: 'unavailable' },
  } satisfies CapsuleSessionRecord;
  await admitCapsuleRecord({ projectDirectory, record });
  return { projectDirectory, sessionId, executionId };
}

function collectorStorage(input: {
  readonly projectDirectory: string;
  readonly sessionId: string;
  readonly executionId: string;
}): string {
  return sandboxTelemetryStorageDirectory({
    recordDirectory: capsuleSandboxRecordDirectory(input),
    sandboxId: input.executionId,
  });
}

async function collectorFixture(
  input: Awaited<ReturnType<typeof sessionFixture>>,
): Promise<CollectorHandle> {
  const collector = await startCollector({
    kind: 'start-collector',
    storageDirectory: collectorStorage(input),
    sessionId: input.sessionId,
    executionId: input.executionId,
    endpoint: {
      kind: 'http',
      host: '127.0.0.1',
      port: 0,
      tracesPath: '/v1/traces',
      activationPath: '/v1/activation',
      readinessPath: '/ready',
      readPath: '/v1/collector',
    },
    authorization: { kind: 'bearer-token', token: 'observations-test-token' },
    limits: { maxRequestBytes: 4096, shutdownTimeoutMs: 100 },
  });
  collectors.push(collector);
  return collector;
}

function traceRequest(activityId: string): Record<string, unknown> {
  return {
    resourceSpans: [
      {
        scopeSpans: [
          {
            spans: [
              {
                traceId,
                spanId: 'aaaaaaaaaaaaaaaa',
                name: 'create-order',
                startTimeUnixNano: '1750000000000000000',
                endTimeUnixNano: '1750000000001000000',
                attributes: [
                  { key: 'blackbox.activity.id', value: { stringValue: activityId } },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

async function postTrace(collector: CollectorHandle, activityId: string): Promise<void> {
  const response = await fetch(collector.endpoint.tracesUrl, {
    method: 'POST',
    headers: {
      authorization: 'Bearer observations-test-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify(traceRequest(activityId)),
  });
  expect(response.status).toBe(200);
}

afterEach(async () => {
  await Promise.all(collectors.splice(0).map((collector) => collector.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('reads exact retained session, activity, and trace observations from the Capsule identity', async () => {
  const fixture = await sessionFixture('quiet-river-ada');
  const collector = await collectorFixture(fixture);
  await postTrace(collector, 'activity-7');

  await expect(
    readCapsuleObservations({ ...fixture, selection: { kind: 'session' } }),
  ).resolves.toMatchObject({
    kind: 'collector-session-found',
    fragments: [{ sequence: 1, spanCount: 1 }],
    traceIds: [traceId],
  });
  await expect(
    readCapsuleObservations({
      ...fixture,
      selection: { kind: 'activity', activityId: 'activity-7' },
    }),
  ).resolves.toMatchObject({
    kind: 'collector-activity-found',
    activityId: 'activity-7',
    traceIds: [traceId],
  });
  await expect(
    readCapsuleObservations({ ...fixture, selection: { kind: 'trace', traceId } }),
  ).resolves.toMatchObject({ kind: 'collector-trace-found', traceId });
});

it('distinguishes missing exact selections from a corrupt retained collector lifecycle', async () => {
  const missing = await sessionFixture('gentle-forest-zoe');
  await expect(
    readCapsuleObservations({ ...missing, selection: { kind: 'session' } }),
  ).resolves.toMatchObject({ kind: 'collector-session-missing' });
  await expect(
    readCapsuleObservations({
      ...missing,
      selection: { kind: 'activity', activityId: 'missing-activity' },
    }),
  ).resolves.toMatchObject({ kind: 'collector-activity-missing' });
  await expect(
    readCapsuleObservations({ ...missing, selection: { kind: 'trace', traceId } }),
  ).resolves.toMatchObject({ kind: 'collector-trace-missing' });

  const corrupt = await sessionFixture('rapid-harbor-alex');
  const directory = join(
    collectorStorage(corrupt),
    corrupt.sessionId,
    corrupt.executionId,
  );
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'collector-lifecycle.json'), '{not-json');
  await expect(
    readCapsuleObservations({ ...corrupt, selection: { kind: 'session' } }),
  ).resolves.toMatchObject({ kind: 'collector-session-corrupt' });
  await expect(
    readCapsuleObservations({
      ...corrupt,
      selection: { kind: 'activity', activityId: 'activity-1' },
    }),
  ).resolves.toMatchObject({ kind: 'collector-activity-corrupt' });
  await expect(
    readCapsuleObservations({ ...corrupt, selection: { kind: 'trace', traceId } }),
  ).resolves.toMatchObject({ kind: 'collector-trace-corrupt' });
});
