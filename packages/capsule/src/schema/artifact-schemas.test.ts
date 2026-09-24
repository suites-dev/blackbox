import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';

import type { CapsuleSessionRecord } from '../records.js';
import type { CapsuleActivityReport } from '../types.js';
import type { CapsuleReportDocument } from '../reporting/types.js';
import { capsuleProgressSchema } from '../progress/schema.js';
import {
  capsuleActivitiesSchema,
  capsuleOperationalReportSchema,
  capsuleSessionSchema,
} from './artifact-schemas.js';

const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addSchema(capsuleProgressSchema);
ajv.addSchema(capsuleSessionSchema);
ajv.addSchema(capsuleActivitiesSchema);

function schemaValidator(id: string): ValidateFunction {
  const validator = ajv.getSchema(id);
  if (validator === undefined) {
    throw new Error(`Schema was not registered: ${id}`);
  }
  return validator;
}

const validateSession = schemaValidator(
  'https://suites.dev/blackbox/schemas/capsule-session-v1.json',
);
const validateActivities = schemaValidator(
  'https://suites.dev/blackbox/schemas/capsule-activities-v1.json',
);
const validateReport = ajv.compile(capsuleOperationalReportSchema);

function session(): CapsuleSessionRecord {
  return {
    schemaVersion: 1,
    sessionId: 'quiet-river-ada',
    executionId: 'execution-1',
    system: 'orders',
    title: 'Orders exploration',
    description: { kind: 'omitted' },
    state: 'admitted',
    revision: 0,
    admittedAt: '2026-09-24T00:00:00.000Z',
    updatedAt: '2026-09-24T00:00:00.000Z',
    manager: { kind: 'not-started' },
    socketPath: '/tmp/capsule.sock',
    entrypoint: { kind: 'unavailable' },
    containers: [],
    cleanup: { kind: 'not-attempted' },
    failure: { kind: 'none' },
    composeProject: { kind: 'unavailable' },
    artifactRoot: '/tmp/capsule',
    networks: [],
    volumes: [],
    readiness: { kind: 'unavailable' },
  };
}

function activity(): Extract<CapsuleActivityReport, { readonly kind: 'completed' }> {
  return {
    kind: 'completed',
    activityId: 'activity-1',
    sequence: 1,
    target: { kind: 'client', clientId: 'create-order' },
    argv: ['one'],
    startedAt: '2026-09-24T00:00:01.000Z',
    completedAt: '2026-09-24T00:00:02.000Z',
    outcome: {
      kind: 'client-completed',
      client: { id: 'create-order', name: 'create-order', behavior: 'entrypoint' },
      result: { kind: 'json', value: { ok: true } },
      telemetry: { kind: 'complete' },
    },
  };
}

function report(): CapsuleReportDocument {
  return {
    schemaVersion: 1,
    kind: 'capsule-operational-report',
    session: {
      sessionId: 'quiet-river-ada',
      system: 'orders',
      title: 'Orders exploration',
      description: { kind: 'omitted' },
      retainedState: 'stopped',
      admittedAt: '2026-09-24T00:00:00.000Z',
      updatedAt: '2026-09-24T00:00:03.000Z',
      artifactRoot: '[REDACTED]',
    },
    lifecycle: { kind: 'stopped', retainedState: 'stopped' },
    composeProject: { kind: 'available', value: 'orders' },
    entrypoint: { kind: 'unavailable' },
    resources: { containers: [], networks: [], volumes: [] },
    readiness: { kind: 'unavailable' },
    activities: [activity()],
    activityTelemetry: [],
    progress: [],
    observations: {
      kind: 'collector-session-found',
      telemetry: {
        status: 'received',
        acceptedRequests: 1,
        acceptedSpans: 2,
        lastReceivedAt: '2026-09-24T00:00:02.000Z',
      },
      fragmentCount: 1,
      traceIds: ['trace-1'],
      activations: [
        {
          runtime: 'node',
          serviceName: 'orders-api',
          activatedAt: '2026-09-24T00:00:01.000Z',
        },
      ],
    },
    cleanup: { kind: 'complete' },
    failure: { kind: 'none' },
    redactions: { count: 0, entries: [] },
  };
}

describe('Capsule session artifact schema', () => {
  it('accepts the retained record and rejects invalid union branches', () => {
    expect(validateSession(session())).toBe(true);
    const base = session();
    for (const invalid of [
      { ...base, description: { kind: 'omitted', value: 'not allowed' } },
      { ...base, manager: { kind: 'started' } },
      { ...base, entrypoint: { kind: 'unknown' } },
      { ...base, cleanup: { kind: 'failed' } },
      { ...base, state: 'running' },
    ]) {
      expect(validateSession(invalid)).toBe(false);
    }
  });
});

describe('Capsule activities artifact schema', () => {
  it('accepts every activity layer and rejects mismatched discriminators', () => {
    const validRunning = {
      kind: 'running',
      activityId: 'activity-2',
      sequence: 2,
      target: { kind: 'host' },
      argv: ['true'],
      startedAt: '2026-09-24T00:00:03.000Z',
    } satisfies CapsuleActivityReport;
    expect(validateActivities([validRunning, activity()])).toBe(true);
    for (const invalid of [
      [{ ...activity(), kind: 'unknown' }],
      [{ ...activity(), target: { kind: 'host', participant: 'api' } }],
      [
        {
          ...activity(),
          outcome: { kind: 'signaled', argv: [], exitCode: 1, stdout: '', stderr: '' },
        },
      ],
      [{ ...activity(), outcome: { ...activity().outcome, telemetry: { kind: 'incomplete' } } }],
    ]) {
      expect(validateActivities(invalid)).toBe(false);
    }
  });
});

describe('Capsule operational report schema', () => {
  it('validates the projection and rejects crossed report branches', () => {
    expect(validateReport(report())).toBe(true);
    const span = {
      traceId: 'trace',
      spanId: 'span',
      parentSpanId: null,
      operation: 'GET',
      service: 'api',
      startTimeUnixNano: null,
      endTimeUnixNano: null,
      statusCode: null,
      attributes: [],
      links: [],
    };
    expect(
      validateReport({
        ...report(),
        activityTelemetry: [{ kind: 'available', activityId: 'one', spans: [span] }],
      }),
    ).toBe(true);
    expect(
      validateReport({
        ...report(),
        activityTelemetry: [
          { kind: 'available', activityId: 'one', spans: [{ ...span, links: [{}] }] },
        ],
      }),
    ).toBe(false);
    const base = report();
    for (const invalid of [
      { ...base, kind: 'capsule-assurance-report' },
      { ...base, activityTelemetry: [{ kind: 'available', activityId: 'one', spans: [] }] },
      { ...base, activityTelemetry: [{ kind: 'unavailable', activityId: 'one' }] },
      {
        ...base,
        activityTelemetry: [
          { kind: 'unavailable', activityId: 'one', reason: 'not-retained', spans: [] },
        ],
      },
      {
        ...base,
        activityTelemetry: [{ kind: 'unavailable', activityId: 'one', reason: 'zero-effects' }],
      },
      { ...base, lifecycle: { kind: 'running', retainedState: 'stopped' } },
      {
        ...base,
        observations: {
          kind: 'collector-session-missing',
          message: 'missing',
          identity: { executionId: 'private', sessionId: 'private' },
        },
      },
      { ...base, observations: { kind: 'collector-session-found', traceIds: [] } },
    ]) {
      expect(validateReport(invalid)).toBe(false);
    }
  });
});
