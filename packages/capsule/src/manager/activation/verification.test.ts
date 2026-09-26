import { afterEach, describe, expect, it, vi } from 'vitest';

import { activationPlan, activationSandbox } from './verification.fixture.js';
import { verifyRequiredInstrumentationActivations } from './verification.js';

function collectorStatus(instrumentation: object): Response {
  return Response.json({
    kind: 'collector-status',
    sessionId: 'quiet-river-ada',
    executionId: 'execution-1',
    instrumentation,
  });
}

function verify(configured: boolean, timeoutMs = 25) {
  return verifyRequiredInstrumentationActivations({
    kind: 'verify-required-instrumentation-activations',
    plan: activationPlan({ configured, projectDirectory: '/tmp/project' }),
    sandbox: activationSandbox(),
    authorizationToken: 'secret',
    sessionId: 'quiet-river-ada',
    executionId: 'execution-1',
    timeoutMs,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('required instrumentation activation', () => {
  it('does not query the collector when no participant requires activation', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(verify(false)).resolves.toEqual({
      kind: 'instrumentation-activation-not-required',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('admits readiness only after the exact configured participant activates', async () => {
    const fetch = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      expect(url).toBe('http://collector.test/status');
      if (init === undefined) {
        throw new Error('Expected collector request options');
      }
      expect(init.headers).toEqual({ authorization: 'Bearer secret' });
      return Promise.resolve(
        collectorStatus({
          kind: 'activated',
          activations: [
            { kind: 'instrumentation-activation', runtime: 'node', serviceName: 'api' },
          ],
        }),
      );
    });
    vi.stubGlobal('fetch', fetch);
    await expect(verify(true)).resolves.toEqual({
      kind: 'instrumentation-activation-verified',
      activations: [{ runtime: 'node', serviceName: 'api' }],
    });
  });

  it('fails visibly when a required participant never activates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(collectorStatus({ kind: 'not-activated' }))),
    );
    await expect(verify(true, 1)).rejects.toThrow(
      'Required instrumentation did not activate before Capsule readiness: api (node).',
    );
  });
});
