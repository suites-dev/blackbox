import { setTimeout as delay } from 'node:timers/promises';

import type { CatalogSandboxInput } from '@suites/blackbox-catalog-internal';
import type { SandboxHandle } from '@suites/blackbox-sandbox-internal';

import {
  missingActivations,
  requiredActivations,
  type RequiredActivation,
} from './requirements.js';
import { readCollectorActivationStatus } from './status.js';

export type ActivationVerificationResult =
  | { readonly kind: 'instrumentation-activation-not-required' }
  | {
      readonly kind: 'instrumentation-activation-verified';
      readonly activations: readonly RequiredActivation[];
    };

function missingMessage(missing: readonly RequiredActivation[], lastError: string): string {
  const names = missing.map((item) => `${item.serviceName} (${item.runtime})`).join(', ');
  const suffix = lastError.length === 0 ? '' : ` Last collector error: ${lastError}`;
  return `Required instrumentation did not activate before Capsule readiness: ${names}.${suffix}`;
}

export async function verifyRequiredInstrumentationActivations(input: {
  readonly kind: 'verify-required-instrumentation-activations';
  readonly plan: CatalogSandboxInput;
  readonly sandbox: SandboxHandle;
  readonly authorizationToken: string;
  readonly sessionId: string;
  readonly executionId: string;
  readonly timeoutMs: number;
}): Promise<ActivationVerificationResult> {
  const required = requiredActivations(input.plan);
  if (required.length === 0) {
    return { kind: 'instrumentation-activation-not-required' };
  }
  const telemetry = await input.sandbox.inspectTelemetry();
  if (telemetry.kind !== 'available') {
    throw new Error(`Required instrumentation cannot be verified: collector is ${telemetry.kind}`);
  }
  const deadline = Date.now() + input.timeoutMs;
  let missing = required;
  let lastError = '';
  do {
    try {
      const status = await readCollectorActivationStatus({
        kind: 'read-collector-activation-status',
        url: telemetry.endpoints.readUrl,
        token: input.authorizationToken,
        sessionId: input.sessionId,
        executionId: input.executionId,
        timeoutMs: Math.min(2_000, Math.max(1, deadline - Date.now())),
      });
      missing = missingActivations(required, status.activations);
      if (missing.length === 0) {
        return { kind: 'instrumentation-activation-verified', activations: required };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(Math.min(100, Math.max(1, deadline - Date.now())));
  } while (Date.now() < deadline);
  throw new Error(missingMessage(missing, lastError));
}
