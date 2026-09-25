import { afterEach, expect, it, vi } from 'vitest';

import { activationPlan, activationSandbox } from './verification.fixture.js';
import { verifyRequiredInstrumentationActivations } from './verification.js';

function verify(sandbox = activationSandbox()) {
  return verifyRequiredInstrumentationActivations({
    kind: 'verify-required-instrumentation-activations',
    plan: activationPlan(true),
    sandbox,
    authorizationToken: 'secret',
    sessionId: 'quiet-river-ada',
    executionId: 'execution-1',
    timeoutMs: 1,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it('fails before readiness when required activation evidence is unavailable', async () => {
  const base = activationSandbox();
  const sandbox = {
    ...base,
    telemetry: { kind: 'disabled' as const },
    inspectTelemetry: () => Promise.resolve({ kind: 'disabled' as const }),
  };
  await expect(verify(sandbox)).rejects.toThrow(
    'Required instrumentation cannot be verified: collector is disabled',
  );
});

it('retains an exact-identity collector error in the startup failure', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        Response.json({
          kind: 'collector-status',
          sessionId: 'another-session',
          executionId: 'execution-1',
          instrumentation: { kind: 'not-activated' },
        }),
      ),
    ),
  );
  await expect(verify()).rejects.toThrow(
    'Last collector error: Collector status identity does not match the Capsule',
  );
});
