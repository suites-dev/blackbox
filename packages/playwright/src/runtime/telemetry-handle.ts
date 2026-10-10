import { readCollectorSession, readCollectorTrace } from '@suites/blackbox-otel-collector';
import { sandboxTelemetryStorageDirectory, type SandboxHandle } from '@suites/blackbox-sandbox';

import type { BlackboxTelemetry } from '../types.js';

export function publicTelemetry(input: {
  readonly sandbox: SandboxHandle;
  readonly recordDirectory: string;
  readonly sessionId: string;
  readonly executionId: string;
}): BlackboxTelemetry {
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
