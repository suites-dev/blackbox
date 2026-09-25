import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startCollector, type CollectorHandle } from '@suites/blackbox-otel-collector-internal';
import { sandboxTelemetryStorageDirectory } from '@suites/blackbox-sandbox-internal';

import { admitCapsuleRecord, capsuleSandboxRecordDirectory, capsuleSessionDirectory,
  writeCapsuleActivities, type CapsuleSessionRecord } from '../../records.js';

const roots: string[] = [];
const collectors: CollectorHandle[] = [];
export const traceId = '11111111111111111111111111111111';

function activity(activityId: string, startedAt: string) {
  return {
    kind: 'running',
    activityId,
    sequence: 1,
    purpose: 'stimulus',
    target: { kind: 'host' },
    argv: ['true'],
    startedAt,
    telemetry: {
      schemaVersion: 1,
      kind: 'telemetry-execution-scope-active-v1',
      executionId: activityId,
      operationName: 'capsule.host',
      startedAt,
      context: {
        kind: 'w3c-trace-context',
        traceId,
        spanId: 'aaaaaaaaaaaaaaaa',
        traceFlags: '01',
        traceparent: `00-${traceId}-aaaaaaaaaaaaaaaa-01`,
        traceState: { kind: 'trace-state-absent' },
      },
    },
  } as const;
}

export async function sessionFixture(sessionId: string, activityId: string | null = null) {
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
  if (activityId !== null) {
    await writeCapsuleActivities({
      projectDirectory,
      sessionId,
      activities: [activity(activityId, at)],
    });
  }
  return { projectDirectory, sessionId, executionId };
}

export function collectorStorage(input: {
  readonly projectDirectory: string;
  readonly sessionId: string;
  readonly executionId: string;
}): string {
  return sandboxTelemetryStorageDirectory({
    recordDirectory: capsuleSandboxRecordDirectory(input),
    sandboxId: input.executionId,
  });
}

export async function collectorFixture(
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
                spanId: 'bbbbbbbbbbbbbbbb',
                parentSpanId: 'aaaaaaaaaaaaaaaa',
                name: 'downstream-api',
              },
              {
                traceId,
                spanId: 'aaaaaaaaaaaaaaaa',
                name: 'create-order',
                startTimeUnixNano: '1750000000000000000',
                endTimeUnixNano: '1750000000001000000',
                attributes: [{ key: 'blackbox.activity.id', value: { stringValue: activityId } }],
              },
            ],
          },
        ],
      },
    ],
  };
}

export async function postTrace(collector: CollectorHandle, activityId: string): Promise<void> {
  const response = await fetch(collector.endpoint.tracesUrl, {
    method: 'POST',
    headers: {
      authorization: 'Bearer observations-test-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify(traceRequest(activityId)),
  });
  if (response.status !== 200) {
    throw new Error(`Expected collector acceptance, received HTTP ${response.status}`);
  }
}

export async function cleanObservationFixtures(): Promise<void> {
  await Promise.all(collectors.splice(0).map((collector) => collector.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}
