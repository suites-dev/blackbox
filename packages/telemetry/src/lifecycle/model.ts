import type { W3CTraceContext } from '../context/model.js';

export interface TelemetryScopeSucceeded {
  readonly kind: 'telemetry-scope-succeeded';
}

export interface TelemetryScopeFailed {
  readonly kind: 'telemetry-scope-failed';
  readonly message: string;
}

export interface TelemetryScopeInterrupted {
  readonly kind: 'telemetry-scope-interrupted';
  readonly reason: string;
}

export type TelemetryScopeResult =
  | TelemetryScopeSucceeded
  | TelemetryScopeFailed
  | TelemetryScopeInterrupted;

export interface ActiveTelemetryExecutionScopeRecord {
  readonly schemaVersion: 1;
  readonly kind: 'telemetry-execution-scope-active-v1';
  readonly executionId: string;
  readonly operationName: string;
  readonly startedAt: string;
  readonly context: W3CTraceContext;
}

export interface CompletedTelemetryExecutionScopeRecord {
  readonly schemaVersion: 1;
  readonly kind: 'telemetry-execution-scope-completed-v1';
  readonly executionId: string;
  readonly operationName: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly context: W3CTraceContext;
  readonly result: TelemetryScopeResult;
}

export type TelemetryExecutionScopeRecord =
  | ActiveTelemetryExecutionScopeRecord
  | CompletedTelemetryExecutionScopeRecord;
