import { join } from 'node:path';

import type { CapsuleSessionRecord } from '../../records.js';
import { activeTelemetry } from '../../persistence/testing/record.fixture.js';
import type { CapsuleActivityReport } from '../../types.js';
import type { CapsuleManagerRecoveryPorts } from './index.js';

export const completedAt = '2026-09-25T10:00:00.000Z';

export function runningRecord(projectDirectory: string): CapsuleSessionRecord {
  const sessionId = 'quiet-river-ada';
  return {
    schemaVersion: 1,
    sessionId,
    executionId: '11111111-1111-4111-8111-111111111111',
    system: 'orders',
    title: 'Orders experiment',
    description: { kind: 'omitted' },
    state: 'running',
    revision: 4,
    admittedAt: '2026-09-25T09:00:00.000Z',
    updatedAt: '2026-09-25T09:01:00.000Z',
    manager: { kind: 'started', pid: 42_424 },
    socketPath: join(projectDirectory, 'manager.sock'),
    entrypoint: {
      kind: 'available',
      value: { url: 'http://localhost:3000', host: 'localhost', port: 3000, protocol: 'http' },
    },
    containers: [],
    cleanup: { kind: 'not-attempted' },
    failure: { kind: 'none' },
    composeProject: { kind: 'available', value: 'bb-orders' },
    artifactRoot: join(projectDirectory, '.blackbox', 'experiments', `capsule-${sessionId}`),
    networks: ['bb-orders_default'],
    volumes: ['bb-orders_data'],
    readiness: {
      kind: 'available',
      value: { url: 'http://localhost:3000/health', status: 'ready', durationMs: 100 },
    },
  };
}

export function runningActivity(activityId = 'activity-running'): CapsuleActivityReport {
  return {
    kind: 'running',
    activityId,
    sequence: 2,
    name: { kind: 'omitted' },
    purpose: 'stimulus',
    target: { kind: 'host' },
    argv: ['curl', 'http://localhost:3000'],
    telemetry: activeTelemetry(activityId),
    startedAt: '2026-09-25T09:02:00.000Z',
  };
}

export function processError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

export function noSandboxRecord(): ReturnType<CapsuleManagerRecoveryPorts['recoverSandbox']> {
  return Promise.resolve({
    kind: 'sandbox-recovery-not-required',
    reason: 'record-not-found',
    record: { kind: 'unavailable' },
  });
}
