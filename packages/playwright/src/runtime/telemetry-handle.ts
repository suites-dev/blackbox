import { readCollectorSession, readCollectorTrace } from '@suites/blackbox-otel-collector';
import { sandboxTelemetryStorageDirectory, type SandboxHandle } from '@suites/blackbox-sandbox';

import type { BlackboxTelemetry } from '../types.js';

/** Telemetry reads owned by the runtime; the fixture adds the attempt trace context. */
export type AttemptTelemetry = Omit<BlackboxTelemetry, 'traceId' | 'traceparent'>;

export function publicTelemetry(input: {
  readonly sandbox: SandboxHandle;
  readonly recordDirectory: string;
  readonly sessionId: string;
  readonly executionId: string;
}): AttemptTelemetry {
  const identity = {
    sessionId: input.sessionId,
    executionId: input.executionId,
    storageDirectory: sandboxTelemetryStorageDirectory({
      recordDirectory: input.recordDirectory,
      sandboxId: input.executionId,
    }),
  };
  return Object.freeze({
    sessionId: input.sessionId,
    executionId: input.executionId,
    inspect: () => input.sandbox.inspectTelemetry(),
    read: () => readCollectorSession(identity),
    readTrace: (traceId: string) => readCollectorTrace({ ...identity, traceId }),
  });
}
