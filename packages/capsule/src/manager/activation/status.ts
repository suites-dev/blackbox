interface ActivationEvidence {
  readonly runtime: string;
  readonly serviceName: string;
}

export interface CollectorActivationStatus {
  readonly kind: 'collector-activation-status';
  readonly activations: readonly ActivationEvidence[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Collector status ${name} is invalid`);
  }
  return value;
}

function activation(value: unknown): ActivationEvidence {
  if (!isRecord(value) || value.kind !== 'instrumentation-activation') {
    throw new Error('Collector status contains an invalid instrumentation activation');
  }
  return {
    runtime: requiredString(value.runtime, 'activation runtime'),
    serviceName: requiredString(value.serviceName, 'activation service name'),
  };
}

function activations(value: unknown): readonly ActivationEvidence[] {
  if (!isRecord(value)) {
    throw new Error('Collector instrumentation status is invalid');
  }
  if (value.kind === 'not-activated') {
    return [];
  }
  if (value.kind !== 'activated' || !Array.isArray(value.activations)) {
    throw new Error('Collector instrumentation status is invalid');
  }
  return value.activations.map(activation);
}

function decodeStatus(input: {
  readonly value: unknown;
  readonly sessionId: string;
  readonly executionId: string;
}): CollectorActivationStatus {
  if (!isRecord(input.value) || input.value.kind !== 'collector-status') {
    throw new Error('Collector status response is invalid');
  }
  if (input.value.sessionId !== input.sessionId || input.value.executionId !== input.executionId) {
    throw new Error('Collector status identity does not match the Capsule');
  }
  return {
    kind: 'collector-activation-status',
    activations: activations(input.value.instrumentation),
  };
}

export async function readCollectorActivationStatus(input: {
  readonly kind: 'read-collector-activation-status';
  readonly url: string;
  readonly token: string;
  readonly sessionId: string;
  readonly executionId: string;
  readonly timeoutMs: number;
}): Promise<CollectorActivationStatus> {
  const response = await fetch(input.url, {
    headers: { authorization: `Bearer ${input.token}` },
    signal: AbortSignal.timeout(Math.max(1, input.timeoutMs)),
  });
  if (!response.ok) {
    throw new Error(`Collector status returned HTTP ${response.status}`);
  }
  const value: unknown = await response.json();
  return decodeStatus({ ...input, value });
}
