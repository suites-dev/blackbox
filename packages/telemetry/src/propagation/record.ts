import type {
  PropagationExpectation,
  PropagationOutcome,
  TelemetryPropagationRecord,
} from './model.js';

function requireValue(name: string, value: string): void {
  if (value.trim() === '') {
    throw new Error(`${name} must be non-empty.`);
  }
}

function requireMatch(
  expectation: PropagationExpectation,
  outcome: PropagationOutcome,
): void {
  if (expectation.kind === 'shared-state-propagation-unsupported') {
    requireValue('expected shared-state resource', expectation.resource);
  }
  if (outcome.kind === 'context-not-supported') {
    requireValue('observed shared-state resource', outcome.resource);
  }
  if (outcome.kind === 'context-injection-failed') {
    requireValue('context injection failure message', outcome.message);
  }
  if (expectation.kind === 'propagation-not-requested') {
    if (outcome.kind !== 'context-not-injected') {
      throw new Error('Unrequested propagation must record context-not-injected.');
    }
    return;
  }
  if (expectation.kind === 'shared-state-propagation-unsupported') {
    if (
      outcome.kind !== 'context-not-supported' ||
      outcome.resource !== expectation.resource
    ) {
      throw new Error('Shared-state propagation must preserve its resource limitation.');
    }
    return;
  }
  if (
    (outcome.kind !== 'context-injected' &&
      outcome.kind !== 'context-injection-failed') ||
    outcome.carrier !== expectation.carrier
  ) {
    throw new Error('W3C propagation must record the expected carrier outcome.');
  }
}

export function createTelemetryPropagationRecord(input: {
  readonly expectation: PropagationExpectation;
  readonly outcome: PropagationOutcome;
}): TelemetryPropagationRecord {
  requireMatch(input.expectation, input.outcome);
  return {
    schemaVersion: 1,
    kind: 'telemetry-propagation-v1',
    expectation: input.expectation,
    outcome: input.outcome,
  };
}
