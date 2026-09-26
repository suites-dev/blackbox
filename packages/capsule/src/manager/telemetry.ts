import type { CatalogSandboxInput } from '@suites/blackbox-catalog-internal';
import type { SandboxTelemetryEnabledInput } from '@suites/blackbox-sandbox-internal';

import type { CapsuleManagerBootstrap } from '../protocol.js';
import type { CapsuleCollectorRuntime } from './collector-runtime.js';
import { participantTelemetry } from './telemetry/participants.js';

export interface CapsuleTelemetryAuthorization {
  readonly kind: 'split-bearer-tokens';
  readonly ingestToken: string;
  readonly controlToken: string;
}

export function capsuleSandboxTelemetry(input: {
  readonly bootstrap: CapsuleManagerBootstrap;
  readonly plan: CatalogSandboxInput;
  readonly authorization: CapsuleTelemetryAuthorization;
  readonly collectorRuntime: CapsuleCollectorRuntime;
}): SandboxTelemetryEnabledInput {
  return {
    kind: 'enabled',
    sessionId: input.bootstrap.sessionId,
    executionId: input.bootstrap.executionId,
    authorization: input.authorization,
    collector: {
      service: 'blackbox-otel-collector',
      containerPort: 4318,
      runtime: input.collectorRuntime,
      environment: {
        BLACKBOX_OTEL_MAX_REQUEST_BYTES: String(16 * 1024 * 1024),
        BLACKBOX_OTEL_MAX_RETAINED_BYTES: String(256 * 1024 * 1024),
        BLACKBOX_OTEL_MAX_RETAINED_FRAGMENTS: '4096',
        BLACKBOX_OTEL_SHUTDOWN_TIMEOUT_MS: '10000',
      },
      readiness: {
        kind: 'http',
        path: '/ready',
        intervalSeconds: 1,
        timeoutSeconds: 3,
        retries: 60,
      },
      drain: { kind: 'signal', signal: 'SIGTERM' },
    },
    participants: participantTelemetry({ plan: input.plan, bootstrap: input.bootstrap }),
  };
}
