import {
  createTelemetryPropagationRecord,
  injectW3CProcessEnvironment,
  type PropagationExpectation,
  type TelemetryExecutionScope,
  type TelemetryPropagationRecord,
} from '@suites/blackbox-telemetry-internal';

export function executionEnvironment(input: {
  readonly base: Readonly<Record<string, string>>;
  readonly prepared: Readonly<Record<string, string>>;
  readonly propagation: TelemetryPropagationRecord;
  readonly scope: TelemetryExecutionScope;
}): Readonly<Record<string, string>> {
  for (const key of Object.keys(input.prepared)) {
    if (Object.hasOwn(input.base, key) || key.startsWith('BLACKBOX_OTEL_')) {
      throw new Error(`Driver may not override reserved environment key ${key}`);
    }
  }
  const environment = { ...input.base, ...input.prepared };
  const outcome = input.propagation.outcome;
  if (outcome.kind === 'context-injected' && outcome.carrier === 'process-environment') {
    return injectW3CProcessEnvironment({
      context: input.scope.active.context,
      carrier: environment,
    }).variables;
  }
  for (const key of Object.keys(environment)) {
    const canonical = key.toUpperCase();
    if (canonical === 'TRACEPARENT' || canonical === 'TRACESTATE') {
      throw new Error(`Driver may not provide undeclared trace environment key ${key}`);
    }
  }
  return environment;
}

export function failedPropagation(
  expectation: PropagationExpectation,
  message: string,
): TelemetryPropagationRecord {
  if (expectation.kind === 'shared-state-propagation-unsupported') {
    return createTelemetryPropagationRecord({
      expectation,
      outcome: {
        kind: 'context-not-supported',
        boundary: 'shared-state',
        resource: expectation.resource,
      },
    });
  }
  if (expectation.kind === 'propagation-not-requested') {
    return createTelemetryPropagationRecord({
      expectation,
      outcome: { kind: 'context-not-injected', reason: 'driver-declared-none' },
    });
  }
  return createTelemetryPropagationRecord({
    expectation,
    outcome: {
      kind: 'context-injection-failed',
      format: 'w3c-trace-context',
      carrier: expectation.carrier,
      message,
    },
  });
}
