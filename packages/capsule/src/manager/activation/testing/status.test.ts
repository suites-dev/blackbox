import { expect, it } from 'vitest';

import { readCollectorActivationStatus } from '../status.js';
import { activationPlan, activationSandbox } from '../verification.fixture.js';
import { verifyRequiredInstrumentationActivations } from '../verification.js';
import { collectorStatusServer } from './http-status.fixture.js';
import { malformedCollectorStatuses } from './status-cases.fixture.js';

const identity = { sessionId: 'quiet-river-ada', executionId: 'execution-1' };

it.each(malformedCollectorStatuses)('rejects $name and cannot verify readiness', async ({ value, error }) => {
  const receiver = await collectorStatusServer({ body: JSON.stringify(value), status: 200 });
  try {
    await expect(readCollectorActivationStatus({ kind: 'read-collector-activation-status',
      ...identity, token: 'token', url: receiver.telemetry.endpoints.readUrl, timeoutMs: 1_000,
    })).rejects.toThrow(error);
    await expect(verifyRequiredInstrumentationActivations({
      kind: 'verify-required-instrumentation-activations', ...identity,
      plan: activationPlan(true), authorizationToken: 'token', timeoutMs: 20,
      sandbox: { ...activationSandbox(), telemetry: receiver.telemetry,
        inspectTelemetry: () => Promise.resolve(receiver.telemetry) },
    })).rejects.toThrow('Required instrumentation did not activate before Capsule readiness');
    expect(receiver.requests.length).toBeGreaterThanOrEqual(2);
    expect(receiver.requests.every((url) => url === '/status')).toBe(true);
  } finally {
    await receiver.close();
  }
});

it.each([
  { name: 'invalid JSON', body: '{not-json', status: 200 },
  { name: 'HTTP rejection', body: '{}', status: 503 },
])('rejects $name at the collector boundary', async ({ body, status }) => {
  const receiver = await collectorStatusServer({ body, status });
  try {
    await expect(readCollectorActivationStatus({ kind: 'read-collector-activation-status',
      ...identity, token: 'token', url: receiver.telemetry.endpoints.readUrl, timeoutMs: 1_000,
    })).rejects.toThrow(status === 503 ? 'Collector status returned HTTP 503' : /JSON|property/u);
  } finally {
    await receiver.close();
  }
});
