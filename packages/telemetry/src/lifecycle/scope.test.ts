import { describe, expect, it } from 'vitest';

import {
  createTelemetryExecutionScope,
  createTelemetryExecutionScopeWithPorts,
} from './scope.js';

function scope() {
  const times = ['2026-09-25T10:00:00.000Z', '2026-09-25T10:00:01.000Z'];
  return createTelemetryExecutionScopeWithPorts(
    { executionId: 'activity-1', operationName: 'capsule.exec' },
    {
      now: () => times.shift() ?? 'unexpected-time',
      identifiers: {
        traceId: () => '0102030405060708090a0b0c0d0e0f10',
        spanId: () => '1112131415161718',
      },
    },
  );
}

describe('telemetry execution scope', () => {
  it('creates a production scope with a current timestamp', () => {
    const executionScope = createTelemetryExecutionScope({
      executionId: 'activity-production',
      operationName: 'capsule.exec',
    });
    expect(Date.parse(executionScope.active.startedAt)).not.toBeNaN();
    expect(executionScope.active.context.traceparent).toMatch(/^00-/u);
  });

  it('retains one root identity from admission through completion', () => {
    const executionScope = scope();
    const completed = executionScope.complete({
      kind: 'telemetry-scope-succeeded',
    });

    expect(executionScope.active.kind).toBe(
      'telemetry-execution-scope-active-v1',
    );
    expect(completed).toMatchObject({
      kind: 'telemetry-execution-scope-completed-v1',
      executionId: 'activity-1',
      startedAt: '2026-09-25T10:00:00.000Z',
      endedAt: '2026-09-25T10:00:01.000Z',
      context: executionScope.active.context,
      result: { kind: 'telemetry-scope-succeeded' },
    });
  });

  it('refuses a second terminal result', () => {
    const executionScope = scope();
    executionScope.complete({ kind: 'telemetry-scope-succeeded' });
    expect(() =>
      executionScope.complete({
        kind: 'telemetry-scope-interrupted',
        reason: 'manager stopped',
      }),
    ).toThrow('already complete');
  });

  it.each([
    [{ kind: 'telemetry-scope-failed', message: '' } as const, 'failure message'],
    [
      { kind: 'telemetry-scope-interrupted', reason: ' ' } as const,
      'interruption reason',
    ],
  ])('rejects an empty terminal detail', (result, field) => {
    const executionScope = scope();
    expect(() => executionScope.complete(result)).toThrow(field);
    expect(
      executionScope.complete({ kind: 'telemetry-scope-succeeded' }).result,
    ).toEqual({ kind: 'telemetry-scope-succeeded' });
  });

  it.each([
    [{ executionId: '', operationName: 'capsule.exec' }, 'executionId'],
    [{ executionId: 'activity-1', operationName: ' ' }, 'operationName'],
  ] as const)('rejects an empty identity field', (input, field) => {
    expect(() =>
      createTelemetryExecutionScopeWithPorts(input, {
        now: () => '2026-09-25T10:00:00.000Z',
        identifiers: {
          traceId: () => '0102030405060708090a0b0c0d0e0f10',
          spanId: () => '1112131415161718',
        },
      }),
    ).toThrow(field);
  });
});
