import { setTimeout as delay } from 'node:timers/promises';

import type { CatalogSandboxInput } from '@suites/blackbox-catalog';
import type { SandboxHandle } from '@suites/blackbox-sandbox';

import type { TelemetryAuthorization } from './telemetry.js';

interface RequiredActivation {
  readonly runtime: string;
  readonly serviceName: string;
}

function requiredActivations(plan: CatalogSandboxInput): readonly RequiredActivation[] {
  const unique = new Map<string, RequiredActivation>();
  for (const participant of Object.values(plan.metadata.participants)) {
    if (participant.activation.kind === 'configured') {
      const item = { runtime: participant.runtime, serviceName: participant.service };
      unique.set(`${item.runtime}\u0000${item.serviceName}`, item);
    }
  }
  return [...unique.values()].sort((left, right) =>
    left.serviceName.localeCompare(right.serviceName),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function activation(value: unknown): RequiredActivation {
  if (
    !isRecord(value) ||
    value.kind !== 'instrumentation-activation' ||
    typeof value.runtime !== 'string' ||
    typeof value.serviceName !== 'string'
  ) {
    throw new Error('Collector status contains an invalid instrumentation activation');
  }
  return { runtime: value.runtime, serviceName: value.serviceName };
}

function activationStatus(input: {
  readonly value: unknown;
  readonly sessionId: string;
  readonly executionId: string;
}): readonly RequiredActivation[] {
  const value = input.value;
  if (
    !isRecord(value) ||
    value.kind !== 'collector-status' ||
    value.sessionId !== input.sessionId ||
    value.executionId !== input.executionId ||
    !isRecord(value.instrumentation)
  ) {
    throw new Error('Collector status identity or instrumentation is invalid');
  }
  if (value.instrumentation.kind === 'not-activated') {
    return [];
  }
  if (
    value.instrumentation.kind !== 'activated' ||
    !Array.isArray(value.instrumentation.activations)
  ) {
    throw new Error('Collector instrumentation status is invalid');
  }
  return value.instrumentation.activations.map(activation);
}

async function readActivations(input: {
  readonly url: string;
  readonly authorization: TelemetryAuthorization;
  readonly sessionId: string;
  readonly executionId: string;
  readonly timeoutMs: number;
}): Promise<readonly RequiredActivation[]> {
  const response = await fetch(input.url, {
    headers: { authorization: `Bearer ${input.authorization.controlToken}` },
    signal: AbortSignal.timeout(Math.max(1, input.timeoutMs)),
  });
  if (!response.ok) {
    throw new Error(`Collector status returned HTTP ${response.status}`);
  }
  const value: unknown = await response.json();
  return activationStatus({ ...input, value });
}

export async function verifyRequiredActivations(input: {
  readonly plan: CatalogSandboxInput;
  readonly sandbox: SandboxHandle;
  readonly authorization: TelemetryAuthorization;
  readonly sessionId: string;
  readonly executionId: string;
  readonly timeoutMs: number;
}): Promise<void> {
  const required = requiredActivations(input.plan);
  if (required.length === 0) {
    return;
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
      const observed = await readActivations({
        url: telemetry.endpoints.readUrl,
        authorization: input.authorization,
        sessionId: input.sessionId,
        executionId: input.executionId,
        timeoutMs: Math.min(2_000, Math.max(1, deadline - Date.now())),
      });
      const observedKeys = new Set(
        observed.map((item) => `${item.runtime}\u0000${item.serviceName}`),
      );
      missing = required.filter(
        (item) => !observedKeys.has(`${item.runtime}\u0000${item.serviceName}`),
      );
      if (missing.length === 0) {
        return;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(Math.min(100, Math.max(1, deadline - Date.now())));
  } while (Date.now() < deadline);
  const names = missing.map((item) => `${item.serviceName} (${item.runtime})`).join(', ');
  const suffix = lastError.length === 0 ? '' : ` Last collector error: ${lastError}`;
  throw new Error(`Required instrumentation did not activate before readiness: ${names}.${suffix}`);
}
