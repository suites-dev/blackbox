import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  admitCapsuleRecord,
  capsuleActivityPath,
  capsuleSessionDirectory,
  type CapsuleSessionRecord,
} from '../../records.js';
import { reportCapsule } from '../../session/operations.js';
import type { CapsuleActivityReport, CapsuleSessionState } from '../../types.js';
import {
  completeOutputRetention,
  completedDriverActivity,
  completedTelemetry,
  rawCommandPropagation,
} from '../../persistence/testing/record.fixture.js';
import { serializeCapsuleReportDocument } from '../serialization.js';

const roots: string[] = [];

function record(input: {
  readonly projectDirectory: string;
  readonly sessionId: string;
  readonly state: CapsuleSessionState;
}): CapsuleSessionRecord {
  const at = '2026-09-23T12:00:00.000Z';
  return {
    schemaVersion: 1,
    sessionId: input.sessionId,
    executionId: '11111111-1111-4111-8111-111111111111',
    system: 'orders',
    title: 'Orders experiment',
    description: { kind: 'provided', value: 'Operational session API_TOKEN=description-token' },
    state: input.state,
    revision: 2,
    admittedAt: at,
    updatedAt: at,
    manager: { kind: 'not-started' },
    socketPath: join(input.projectDirectory, '.blackbox/s/private.sock'),
    entrypoint: {
      kind: 'available',
      value: {
        url: 'http://localhost:4123?token=url-token',
        host: 'localhost',
        port: 4123,
        protocol: 'http',
      },
    },
    containers: [
      {
        participant: 'api',
        service: 'api',
        containerId: 'abc',
        containerName: 'api-1',
        host: 'localhost',
        networkNames: ['orders_default'],
      },
    ],
    cleanup: input.state === 'stopped' ? { kind: 'complete' } : { kind: 'not-attempted' },
    failure: input.state.endsWith('failed')
      ? {
          kind: 'recorded',
          error: {
            name: 'Error',
            message: 'Bearer manager-token at /tmp/.blackbox/s/private.sock',
          },
        }
      : { kind: 'none' },
    composeProject: { kind: 'available', value: 'orders-project' },
    artifactRoot: capsuleSessionDirectory(input),
    networks: ['orders_default'],
    volumes: ['orders_data'],
    readiness: {
      kind: 'available',
      value: {
        url: 'http://localhost:4123/health?api_key=readiness-token',
        status: 'ready',
        durationMs: 20,
      },
    },
  };
}

const activity = {
  kind: 'completed',
  activityId: 'activity-1',
  sequence: 1,
  purpose: 'stimulus',
  target: { kind: 'host' },
  argv: ['curl', '--header', 'Authorization: Bearer capsule-e2e-token', 'API_TOKEN=raw-token'],
  telemetry: completedTelemetry('activity-1'),
  outcome: {
    kind: 'exited',
    propagation: rawCommandPropagation,
    argv: ['curl', '--header', 'Authorization: Bearer capsule-e2e-token', '--token', 'raw-token'],
    location: { kind: 'host' },
    exitCode: 0,
    stdout: '{"token":"response-token","status":"ok"}',
    stderr: '/tmp/.blackbox/s/manager.sock TOKEN=output-token',
    retention: completeOutputRetention,
  },
  startedAt: '2026-09-23T12:01:00.000Z',
  completedAt: '2026-09-23T12:01:01.000Z',
} satisfies CapsuleActivityReport;

async function fixture(sessionId: string, state: CapsuleSessionState) {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'capsule-report-'));
  roots.push(projectDirectory);
  await writeFile(join(projectDirectory, 'blackbox.config.yaml'), 'schemaVersion: 1\n');
  await admitCapsuleRecord({
    projectDirectory,
    record: record({ projectDirectory, sessionId, state }),
  });
  await writeFile(capsuleActivityPath({ projectDirectory, sessionId }), JSON.stringify([activity]));
  return { projectDirectory, sessionId };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function expectSafeJson(json: string): void {
  expect(json).toContain('capsule-operational-report');
  expect(json).toContain('[REDACTED]');
  for (const secret of [
    'capsule-e2e-token',
    'response-token',
    'raw-token',
    'manager.sock',
    'description-token',
    'url-token',
    'readiness-token',
    'output-token',
    'socketPath',
  ]) {
    expect(json).not.toContain(secret);
  }
}

async function admitOtherSession(input: {
  readonly projectDirectory: string;
  readonly sessionId: string;
}): Promise<void> {
  await admitCapsuleRecord({
    projectDirectory: input.projectDirectory,
    record: record({ ...input, state: 'running' }),
  });
}

describe('Capsule operational report', () => {
  it('projects exact retained data and removes credentials from every presentation input', async () => {
    const selected = await fixture('bright-river-ada', 'stopped');
    await admitOtherSession({
      projectDirectory: selected.projectDirectory,
      sessionId: 'quiet-forest-grace',
    });
    const result = await reportCapsule(selected);
    expect(result.kind).toBe('capsule-report');
    if (result.kind !== 'capsule-report') {
      return;
    }
    expect(result.document.session.sessionId).toBe('bright-river-ada');
    expect(result.document.lifecycle).toEqual({ kind: 'stopped', retainedState: 'stopped' });
    expect(result.document.resources.networks).toEqual(['orders_default']);
    expect(result.document.redactions.count).toBeGreaterThanOrEqual(6);
    const json = serializeCapsuleReportDocument({ document: result.document });
    expectSafeJson(json);
  });

  it('applies driver-declared argument redaction and retains execution limitations', async () => {
    const selected = await fixture('careful-river-ada', 'stopped');
    const driver = completedDriverActivity();
    await writeFile(capsuleActivityPath(selected), JSON.stringify([driver]));
    const result = await reportCapsule(selected);
    expect(result.kind).toBe('capsule-report');
    if (result.kind !== 'capsule-report') {
      return;
    }
    const projected = result.document.activities[0];
    expect(projected).toMatchObject({
      target: { kind: 'driver', driverId: 'postgres' },
      purpose: 'inspection',
      argv: ['psql', '--password', '[REDACTED]'],
      outcome: {
        kind: 'driver-completed',
        propagation: {
          schemaVersion: 1,
          kind: 'telemetry-propagation-v1',
          expectation: {
            kind: 'shared-state-propagation-unsupported',
            resource: 'postgresql',
          },
          outcome: { kind: 'context-not-supported', boundary: 'shared-state' },
        },
        process: {
          argv: ['psql', '--set', 'trace=[REDACTED]', '--password', '[REDACTED]'],
          location: { kind: 'participant', participantId: 'postgres' },
          retention: { stdout: { kind: 'truncated', omittedBytes: 951_424 } },
        },
      },
    });
    expect(result.document.redactions.entries).toContainEqual({
      kind: 'sensitive-argument',
      location: 'activities[0].argv[2]',
    });
    expect(result.document.redactions.entries).toContainEqual({
      kind: 'sensitive-argument',
      location: 'activities[0].outcome.process.argv[4]',
    });
    expect(JSON.stringify(result.document)).not.toContain('private');
  });

  it.each([
    ['admitted', 'starting'],
    ['manager-starting', 'starting'],
    ['sandbox-starting', 'starting'],
    ['stopping', 'stopping'],
    ['start-failed', 'failed'],
    ['manager-failed', 'failed'],
    ['stop-failed', 'failed'],
    ['running', 'running'],
  ] as const)('represents %s records as %s', async (state, kind) => {
    const selected = await fixture(`steady-comet-${state.replaceAll('-', '')}`, state);
    const result = await reportCapsule(selected);
    expect(result).toMatchObject({ kind: 'capsule-report', document: { lifecycle: { kind } } });
  });
});
