import { basename, dirname, resolve } from 'node:path';

import type { CatalogSandboxInput } from '@suites/blackbox-catalog-internal';
import type {
  SandboxTelemetryEnabledInput,
  SandboxTelemetryParticipant,
} from '@suites/blackbox-sandbox-internal';

import type { CapsuleManagerBootstrap } from '../protocol.js';

export interface CapsuleTelemetryAuthorization {
  readonly kind: 'bearer-token';
  readonly token: string;
}

function participantTelemetry(
  plan: CatalogSandboxInput,
): readonly SandboxTelemetryParticipant[] {
  return Object.values(plan.metadata.participants).flatMap((participant) => {
    if (participant.activation.kind === 'unconfigured') {
      return [];
    }
    if (participant.runtime !== 'node') {
      throw new Error(
        `Activation for runtime ${JSON.stringify(participant.runtime)} is not supported`,
      );
    }
    const activation = plan.metadata.activations[participant.activation.activationId];
    const source = resolve(plan.projectDirectory, dirname(activation.ref));
    const target = '/blackbox/instrumentation';
    return [
      {
        service: participant.service,
        runtime: participant.runtime,
        environment: {
          NODE_OPTIONS: `--require=${target}/${basename(activation.ref)}`,
        },
        mounts: [{ source, target, access: 'read-only' }],
      },
    ];
  });
}

export function capsuleSandboxTelemetry(input: {
  readonly bootstrap: CapsuleManagerBootstrap;
  readonly plan: CatalogSandboxInput;
  readonly authorization: CapsuleTelemetryAuthorization;
}): SandboxTelemetryEnabledInput {
  return {
    kind: 'enabled',
    sessionId: input.bootstrap.sessionId,
    executionId: input.bootstrap.executionId,
    authorization: input.authorization,
    collector: {
      service: 'blackbox-otel-collector',
      image: 'blackbox-otel-collector:dev',
      containerPort: 4318,
      command: { kind: 'image-default' },
      environment: {
        BLACKBOX_OTEL_MAX_REQUEST_BYTES: String(16 * 1024 * 1024),
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
    participants: participantTelemetry(input.plan),
  };
}
