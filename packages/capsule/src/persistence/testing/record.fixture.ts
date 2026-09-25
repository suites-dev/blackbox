import { capsuleSessionDirectory, type CapsuleSessionRecord } from '../../records.js';
import type { CapsuleActivityReport } from '../../types.js';

export const traceId = '11111111111111111111111111111111';
const spanId = '2222222222222222';

const context = {
  kind: 'w3c-trace-context',
  traceId,
  spanId,
  traceFlags: '01',
  traceparent: `00-${traceId}-${spanId}-01`,
  traceState: { kind: 'trace-state-absent' },
} as const;

export function activeTelemetry(activityId: string) {
  return {
    schemaVersion: 1,
    kind: 'telemetry-execution-scope-active-v1',
    executionId: activityId,
    operationName: `capsule.activity.${activityId}`,
    startedAt: '2026-09-23T12:00:00.000Z',
    context,
  } as const;
}

export function completedTelemetry(activityId: string) {
  return {
    ...activeTelemetry(activityId),
    kind: 'telemetry-execution-scope-completed-v1',
    endedAt: '2026-09-23T12:00:01.000Z',
    result: { kind: 'telemetry-scope-succeeded' },
  } as const;
}

export const completeOutputRetention = {
  stdout: { kind: 'complete', originalBytes: 0 },
  stderr: { kind: 'complete', originalBytes: 0 },
} as const;

export const rawCommandPropagation = {
  schemaVersion: 1,
  kind: 'telemetry-propagation-v1',
  expectation: { kind: 'propagation-not-requested' },
  outcome: { kind: 'context-not-injected', reason: 'raw-command' },
} as const;

export function completedHostActivity(): Extract<
  CapsuleActivityReport,
  { readonly kind: 'completed' }
> {
  return {
    kind: 'completed',
    activityId: 'activity-1',
    sequence: 1,
    purpose: 'stimulus',
    target: { kind: 'host' },
    argv: ['curl', 'http://localhost'],
    telemetry: completedTelemetry('activity-1'),
    outcome: {
      kind: 'exited',
      propagation: rawCommandPropagation,
      argv: ['curl', 'http://localhost'],
      location: { kind: 'host' },
      exitCode: 0,
      stdout: '',
      stderr: '',
      retention: completeOutputRetention,
    },
    startedAt: '2026-09-23T12:00:00.000Z',
    completedAt: '2026-09-23T12:00:01.000Z',
  };
}

export function completedDriverActivity(): Extract<
  CapsuleActivityReport,
  { readonly kind: 'completed' }
> {
  return {
    ...completedHostActivity(),
    activityId: 'activity-2',
    sequence: 2,
    purpose: 'inspection',
    target: { kind: 'driver', driverId: 'postgres' },
    argv: ['psql', '--password', 'private'],
    telemetry: completedTelemetry('activity-2'),
    outcome: {
      kind: 'driver-completed',
      driver: {
        id: 'postgres',
        target: {
          kind: 'participant',
          participantId: 'postgres',
          service: 'postgres',
          protocol: 'postgresql',
          containerPort: 5432,
        },
        execution: { kind: 'participant', participantId: 'postgres', service: 'postgres' },
      },
      propagation: {
        schemaVersion: 1,
        kind: 'telemetry-propagation-v1',
        expectation: {
          kind: 'shared-state-propagation-unsupported',
          resource: 'postgresql',
        },
        outcome: {
          kind: 'context-not-supported',
          boundary: 'shared-state',
          resource: 'postgresql',
        },
      },
      redaction: {
        kind: 'driver-redaction',
        requestArgv: { kind: 'positions', positions: [2] },
        preparedArgv: { kind: 'positions', positions: [4] },
        environment: { kind: 'keys', keys: ['PGPASSWORD'] },
      },
      process: {
        kind: 'exited',
        argv: ['psql', '--set', 'trace=present', '--password', 'private'],
        location: { kind: 'participant', participantId: 'postgres', service: 'postgres' },
        exitCode: 0,
        stdout: 'retained head\n[...omitted...]\nretained tail',
        stderr: '',
        retention: {
          stdout: {
            kind: 'truncated',
            originalBytes: 2_000_000,
            retainedBytes: 1_048_576,
            omittedBytes: 951_424,
            retained: 'head-and-tail',
          },
          stderr: { kind: 'complete', originalBytes: 0 },
        },
      },
    },
  };
}

export function retainedRecord(projectDirectory: string): CapsuleSessionRecord {
  const selector = { projectDirectory, sessionId: 'quiet-river-ada' };
  return {
    schemaVersion: 1,
    sessionId: selector.sessionId,
    executionId: '11111111-1111-4111-8111-111111111111',
    system: 'orders',
    title: 'Orders experiment',
    description: { kind: 'omitted' },
    state: 'admitted',
    revision: 0,
    admittedAt: '2026-09-23T12:00:00.000Z',
    updatedAt: '2026-09-23T12:00:00.000Z',
    manager: { kind: 'not-started' },
    socketPath: '/tmp/unstarted.sock',
    entrypoint: { kind: 'unavailable' },
    containers: [],
    cleanup: { kind: 'not-attempted' },
    failure: { kind: 'none' },
    composeProject: { kind: 'unavailable' },
    artifactRoot: capsuleSessionDirectory(selector),
    networks: [],
    volumes: [],
    readiness: { kind: 'unavailable' },
  };
}
