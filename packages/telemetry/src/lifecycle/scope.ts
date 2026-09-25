import {
  createW3CTraceContext,
  secureW3CIdentifierSource,
  type W3CIdentifierSource,
} from '../context/w3c.js';
import type {
  ActiveTelemetryExecutionScopeRecord,
  CompletedTelemetryExecutionScopeRecord,
  TelemetryScopeResult,
} from './model.js';

export interface CreateTelemetryExecutionScopeInput {
  readonly executionId: string;
  readonly operationName: string;
}

export interface TelemetryExecutionScopePorts {
  readonly now: () => string;
  readonly identifiers: W3CIdentifierSource;
}

export interface TelemetryExecutionScope {
  readonly kind: 'telemetry-execution-scope';
  readonly active: ActiveTelemetryExecutionScopeRecord;
  readonly complete: (
    result: TelemetryScopeResult,
  ) => CompletedTelemetryExecutionScopeRecord;
}

const productionPorts = {
  now: () => new Date().toISOString(),
  identifiers: secureW3CIdentifierSource,
} satisfies TelemetryExecutionScopePorts;

function requireValue(name: string, value: string): string {
  if (value.trim() === '') {
    throw new Error(`${name} must be non-empty.`);
  }
  return value;
}

function requireResult(result: TelemetryScopeResult): TelemetryScopeResult {
  if (result.kind === 'telemetry-scope-failed') {
    requireValue('failure message', result.message);
  }
  if (result.kind === 'telemetry-scope-interrupted') {
    requireValue('interruption reason', result.reason);
  }
  return result;
}

export function createTelemetryExecutionScopeWithPorts(
  input: CreateTelemetryExecutionScopeInput,
  ports: TelemetryExecutionScopePorts,
): TelemetryExecutionScope {
  const active = {
    schemaVersion: 1,
    kind: 'telemetry-execution-scope-active-v1',
    executionId: requireValue('executionId', input.executionId),
    operationName: requireValue('operationName', input.operationName),
    startedAt: ports.now(),
    context: createW3CTraceContext(ports.identifiers),
  } satisfies ActiveTelemetryExecutionScopeRecord;
  let completed = false;
  return {
    kind: 'telemetry-execution-scope',
    active,
    complete: (result) => {
      if (completed) {
        throw new Error(`Telemetry execution scope ${active.executionId} is already complete.`);
      }
      const validatedResult = requireResult(result);
      completed = true;
      return {
        ...active,
        kind: 'telemetry-execution-scope-completed-v1',
        endedAt: ports.now(),
        result: validatedResult,
      };
    },
  };
}

export function createTelemetryExecutionScope(
  input: CreateTelemetryExecutionScopeInput,
): TelemetryExecutionScope {
  return createTelemetryExecutionScopeWithPorts(input, productionPorts);
}
