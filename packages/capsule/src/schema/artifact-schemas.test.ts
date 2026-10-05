import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';

import type { CapsuleSessionRecord } from '../records.js';
import type { CapsuleActivityReport } from '../model/execution/activity.js';
import { activeTelemetry, completedDriverActivity } from '../persistence/testing/record.fixture.js';
import { capsuleProgressSchema } from '../progress/schema.js';
import {
  capsuleActivitiesSchema,
  capsuleOperationalReportSchema,
  capsuleSessionSchema,
} from './artifact-schemas.js';
import { report } from './report.fixture.js';

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

const validateSession = schemaValidator('https://suites.dev/blackbox/schemas/capsule-session-v1.json');
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
  return completedDriverActivity();
}


describe('Capsule session artifact schema', () => {
  it('accepts the retained record and rejects invalid union branches', () => {
    expect(validateSession(session())).toBe(true);
    const base = session();
    expect(validateSession({
      ...base,
      manager: { kind: 'started', pid: 12, identity: {
        kind: 'socket-instance', instanceId: 'manager-instance-a',
      } },
    })).toBe(true);
    expect(validateSession({ ...base, manager: { kind: 'started', pid: 12 } })).toBe(true);
    for (const invalid of [
      { ...base, description: { kind: 'omitted', value: 'not allowed' } },
      { ...base, manager: { kind: 'started' } },
      { ...base, manager: { kind: 'started', pid: 12, identity: {
        kind: 'socket-instance', instanceId: '',
      } } },
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
      name: { kind: 'omitted' },
      purpose: 'setup',
      target: { kind: 'host' },
      argv: ['true'],
      telemetry: activeTelemetry('activity-2'),
      startedAt: '2026-09-24T00:00:03.000Z',
    } satisfies CapsuleActivityReport;
    expect(validateActivities([validRunning, activity()])).toBe(true);
    for (const invalid of [
      [{ ...activity(), kind: 'unknown' }],
      [{ ...activity(), target: { kind: 'host', participant: 'api' } }],
      [
        {
          ...activity(),
          outcome: {
            kind: 'signaled',
            argv: ['psql'],
            location: { kind: 'host' },
            exitCode: 1,
            stdout: '',
            stderr: '',
          },
        },
      ],
      [{ ...activity(), purpose: 'future' }],
      [{ ...activity(), name: { kind: 'provided', value: '   ' } }],
      [{ ...activity(), name: { kind: 'provided', value: 'a'.repeat(121) } }],
    ]) {
      expect(validateActivities(invalid)).toBe(false);
    }
  });
});

describe('Capsule operational report schema: #111 additions', () => {
  it('reads reports written before snapshot time, policy and failure causes were kept', () => {
    const earlier = Object.fromEntries(
      Object.entries(report()).filter(([key]) => key !== 'generatedAt' && key !== 'observationPolicy'),
    );
    expect(validateReport(earlier)).toBe(true);
    const boundary = { id: 'effects.http', kind: 'http', authoritativeFor: ['HTTP'] };
    const policy = {
      kind: 'recorded',
      policyId: 'orders-v1',
      terminalObservationWindowMs: 5000,
      redaction: { requestBodies: 'not-captured', headers: [], dynamicIdentifiers: 'kept' },
      requiredBoundaries: ['effects.http'],
      boundaries: [{ ...boundary, required: true, status: 'not-evaluated' }],
    };
    const failed = {
      traceId: 'trace',
      spanId: 'span',
      parentSpanId: null,
      spanKind: 'client',
      operation: 'GET',
      service: 'api',
      startTimeUnixNano: null,
      endTimeUnixNano: null,
      statusCode: 2,
      statusMessage: 'refused',
      exceptions: [{ type: 'java.net.UnknownHostException', message: 'price' }],
      attributes: [{ key: 'error.type', value: 'java.net.UnknownHostException' }],
      links: [],
    };
    const current = {
      ...report(),
      observationPolicy: policy,
      activityTelemetry: [{ kind: 'available', activityId: 'one', spans: [failed] }],
    };
    expect(validateReport(current)).toBe(true);
    const verdict = { ...boundary, required: true, status: 'satisfied' };
    expect(validateReport({ ...current, observationPolicy: { ...policy, boundaries: [verdict] } })).toBe(
      false,
    );
  });

});

describe('Capsule operational report schema', () => {
  it('validates the projection and rejects crossed report branches', () => {
    expect(validateReport(report())).toBe(true);
    const span = {
      traceId: 'trace',
      spanId: 'span',
      parentSpanId: null,
      spanKind: 'client',
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
      { ...base, observations: { kind: 'collector-session-found', traces: [] } },
    ]) {
      expect(validateReport(invalid)).toBe(false);
    }
  });
});
