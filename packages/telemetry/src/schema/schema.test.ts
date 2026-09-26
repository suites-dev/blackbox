import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import {
  telemetryExecutionScopeSchema,
  telemetryPropagationSchema,
} from './index.js';

const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addFormat('date-time', (value: string) => !Number.isNaN(Date.parse(value)));
const validateScope = ajv.compile(telemetryExecutionScopeSchema);
const validatePropagation = ajv.compile(telemetryPropagationSchema);

describe('telemetry artifact schemas', () => {
  it('accepts a completed execution scope artifact', () => {
    expect(
      validateScope({
        schemaVersion: 1,
        kind: 'telemetry-execution-scope-completed-v1',
        executionId: 'activity-1',
        operationName: 'capsule.exec',
        startedAt: '2026-09-25T10:00:00.000Z',
        endedAt: '2026-09-25T10:00:01.000Z',
        context: {
          kind: 'w3c-trace-context',
          traceId: '0102030405060708090a0b0c0d0e0f10',
          spanId: '1112131415161718',
          traceFlags: '01',
          traceparent:
            '00-0102030405060708090a0b0c0d0e0f10-1112131415161718-01',
          traceState: { kind: 'trace-state-absent' },
        },
        result: { kind: 'telemetry-scope-succeeded' },
      }),
    ).toBe(true);
  });

  it('accepts an honest shared-state propagation artifact', () => {
    expect(
      validatePropagation({
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
      }),
    ).toBe(true);
  });

  it('rejects unknown fields and invalid identifiers', () => {
    expect(
      validateScope({
        schemaVersion: 1,
        kind: 'telemetry-execution-scope-active-v1',
        executionId: 'activity-1',
        operationName: 'capsule.exec',
        startedAt: 'not-a-time',
        context: {
          kind: 'w3c-trace-context',
          traceId: '00000000000000000000000000000000',
          spanId: '0000000000000000',
          traceFlags: '01',
          traceparent: 'invalid',
          traceState: { kind: 'trace-state-absent' },
        },
        unexpected: true,
      }),
    ).toBe(false);
  });
});
