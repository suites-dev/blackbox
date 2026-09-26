import { describe, expect, it } from 'vitest';

import { createTelemetryPropagationRecord } from './record.js';

describe('telemetry propagation records', () => {
  it('records a literal command without invented propagation', () => {
    expect(
      createTelemetryPropagationRecord({
        expectation: { kind: 'propagation-not-requested' },
        outcome: { kind: 'context-not-injected', reason: 'raw-command' },
      }).outcome.kind,
    ).toBe('context-not-injected');
  });

  it('records a matching injected carrier', () => {
    expect(
      createTelemetryPropagationRecord({
        expectation: {
          kind: 'w3c-trace-context-propagation',
          carrier: 'http-headers',
        },
        outcome: {
          kind: 'context-injected',
          format: 'w3c-trace-context',
          carrier: 'http-headers',
        },
      }),
    ).toMatchObject({ schemaVersion: 1, kind: 'telemetry-propagation-v1' });
  });

  it('records an honest shared-state limitation', () => {
    expect(
      createTelemetryPropagationRecord({
        expectation: {
          kind: 'shared-state-propagation-unsupported',
          resource: 'postgresql',
        },
        outcome: {
          kind: 'context-not-supported',
          boundary: 'shared-state',
          resource: 'postgresql',
        },
      }).outcome.kind,
    ).toBe('context-not-supported');
  });

  it('records a failed injection against its promised carrier', () => {
    expect(
      createTelemetryPropagationRecord({
        expectation: {
          kind: 'w3c-trace-context-propagation',
          carrier: 'process-environment',
        },
        outcome: {
          kind: 'context-injection-failed',
          format: 'w3c-trace-context',
          carrier: 'process-environment',
          message: 'environment is reserved',
        },
      }).outcome.kind,
    ).toBe('context-injection-failed');
  });

});

describe('telemetry propagation contradictions', () => {
  it.each([
    {
      expectation: { kind: 'propagation-not-requested' } as const,
      outcome: {
        kind: 'context-injected',
        format: 'w3c-trace-context',
        carrier: 'http-headers',
      } as const,
    },
    {
      expectation: {
        kind: 'w3c-trace-context-propagation',
        carrier: 'http-headers',
      } as const,
      outcome: {
        kind: 'context-injected',
        format: 'w3c-trace-context',
        carrier: 'process-environment',
      } as const,
    },
    {
      expectation: {
        kind: 'shared-state-propagation-unsupported',
        resource: 'redis',
      } as const,
      outcome: {
        kind: 'context-not-supported',
        boundary: 'shared-state',
        resource: 'postgresql',
      } as const,
    },
  ])('refuses an outcome that contradicts its expectation', (input) => {
    expect(() => createTelemetryPropagationRecord(input)).toThrow();
  });

  it.each([
    {
      expectation: {
        kind: 'shared-state-propagation-unsupported',
        resource: '',
      } as const,
      outcome: {
        kind: 'context-not-supported',
        boundary: 'shared-state',
        resource: '',
      } as const,
    },
    {
      expectation: {
        kind: 'w3c-trace-context-propagation',
        carrier: 'http-headers',
      } as const,
      outcome: {
        kind: 'context-injection-failed',
        format: 'w3c-trace-context',
        carrier: 'http-headers',
        message: ' ',
      } as const,
    },
  ])('refuses an empty retained detail', (input) => {
    expect(() => createTelemetryPropagationRecord(input)).toThrow('non-empty');
  });
});
