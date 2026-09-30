import type { CollectorLifecycleRecord } from '@suites/blackbox-otel-collector';
import { describe, expect, it } from 'vitest';

import type { CapsuleSessionState } from '../../types.js';
import { observationCompleteness } from '../completeness.js';

type CollectorRunRecord = CollectorLifecycleRecord['runs'][number];

function run(change: Partial<CollectorRunRecord> = {}): CollectorRunRecord {
  return {
    instanceId: 'run-1',
    startedAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:05:00.000Z',
    stoppedAt: '2026-09-01T10:05:00.000Z',
    receiver: 'stopped',
    instrumentation: { kind: 'not-activated' },
    shutdown: 'complete',
    failure: null,
    endpoint: {
      kind: 'http',
      host: '127.0.0.1',
      port: 4318,
      baseUrl: 'http://127.0.0.1:4318',
      tracesPath: '/v1/traces',
      tracesUrl: 'http://127.0.0.1:4318/v1/traces',
      activationPath: '/v1/activation',
      activationUrl: 'http://127.0.0.1:4318/v1/activation',
      readinessPath: '/health',
      readinessUrl: 'http://127.0.0.1:4318/health',
      readPath: '/status',
      readUrl: 'http://127.0.0.1:4318/status',
    },
    ...change,
  };
}

function lifecycle(runs: readonly CollectorRunRecord[]): CollectorLifecycleRecord {
  return {
    schemaVersion: 1,
    sessionId: 'calm-comet-ada',
    executionId: 'execution-1',
    revision: 3,
    runs,
    telemetry: {
      status: 'not-received',
      acceptedRequests: 0,
      acceptedSpans: 0,
      lastReceivedAt: null,
    },
  };
}

const stopped = (runs: readonly CollectorRunRecord[] | null) =>
  observationCompleteness({ state: 'stopped', lifecycle: runs === null ? null : lifecycle(runs) });

describe('observationCompleteness', () => {
  it.each<CapsuleSessionState>([
    'admitted',
    'manager-starting',
    'sandbox-starting',
    'running',
    'stopping',
  ])('is provisional while the capsule is %s, whatever the collector says', (state) => {
    expect(observationCompleteness({ state, lifecycle: lifecycle([run()]) })).toEqual({
      status: 'provisional',
    });
    expect(observationCompleteness({ state, lifecycle: null })).toEqual({ status: 'provisional' });
  });

  it('is complete only when every run stopped, drained completely and recorded no failure', () => {
    expect(stopped([run(), run({ instanceId: 'run-2' })])).toEqual({ status: 'complete' });
  });

  it('is incomplete when a collector shutdown timed out', () => {
    expect(stopped([run(), run({ shutdown: 'timed-out' })])).toEqual({
      status: 'incomplete',
      reason: 'collector shutdown timed out',
    });
  });

  it.each([{ receiver: 'interrupted' as const }, { shutdown: 'interrupted' as const }])(
    'is incomplete when a collector run was interrupted (%j)',
    (change) => {
      expect(stopped([run(change)])).toEqual({
        status: 'incomplete',
        reason: 'collector interrupted',
      });
    },
  );

  it('is incomplete with the failure name when any run failed', () => {
    expect(
      stopped([run(), run({ failure: { name: 'DiskFull', message: 'no space' } }), run()]),
    ).toEqual({
      status: 'incomplete',
      reason: 'collector failed: DiskFull',
    });
  });

  it.each([null, []])('is incomplete without a collector record (%j)', (runs) => {
    expect(stopped(runs)).toEqual({ status: 'incomplete', reason: 'no collector record' });
  });

  it.each<CapsuleSessionState>(['start-failed', 'stop-failed', 'manager-failed'])(
    'is incomplete for a %s capsule, even with a clean collector',
    (state) => {
      expect(observationCompleteness({ state, lifecycle: lifecycle([run()]) })).toEqual({
        status: 'incomplete',
        reason: `capsule ${state}`,
      });
    },
  );

  it('is incomplete when a run never finished stopping', () => {
    expect(
      stopped([run(), run({ receiver: 'draining', shutdown: 'draining', stoppedAt: null })]),
    ).toEqual({
      status: 'incomplete',
      reason: 'collector not stopped',
    });
  });
});
