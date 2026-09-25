import { describe, expect, it } from 'vitest';

import { participantBootstrap, participantPlan } from './participants.fixture.js';
import { participantTelemetry } from './participants.js';

const bootstrap = participantBootstrap({ NODE_OPTIONS: ' --enable-source-maps ' });
const plan = (adapter: string) => participantPlan({ adapter, runtime: 'node', configured: true });

describe('participant telemetry activation', () => {
  it.each([
    ['node-preload', '--enable-source-maps --require=/blackbox/instrumentation/instrumentation.js'],
    [
      'node-esm',
      '--enable-source-maps --experimental-loader=/blackbox/instrumentation/node_modules/' +
        '@opentelemetry/instrumentation/hook.mjs --require=/blackbox/instrumentation/instrumentation.js',
    ],
  ])('uses the provider contract for %s', (adapter, nodeOptions) => {
    expect(participantTelemetry({ plan: plan(adapter), bootstrap })).toMatchObject([
      { service: 'api', runtime: 'node', environment: { NODE_OPTIONS: nodeOptions } },
    ]);
  });

  it('rejects an adapter the runtime provider does not implement', () => {
    expect(() => participantTelemetry({ plan: plan('node-register'), bootstrap })).toThrow(
      'Unsupported Node activation adapter "node-register"',
    );
  });

  it('omits participants without configured instrumentation', () => {
    const unconfigured = participantPlan({
      adapter: 'node-preload',
      runtime: 'node',
      configured: false,
    });
    expect(participantTelemetry({ plan: unconfigured, bootstrap })).toEqual([]);
  });

  it('preserves inherited plan options when the Capsule does not override them', () => {
    const configured = plan('node-preload');
    const inherited = { ...configured, environment: { NODE_OPTIONS: '--trace-warnings' } };
    const result = participantTelemetry({
      plan: inherited,
      bootstrap: participantBootstrap({}),
    });
    expect(result[0].environment.NODE_OPTIONS).toBe(
      '--trace-warnings --require=/blackbox/instrumentation/instrumentation.js',
    );
  });

  it('rejects configured runtimes without an activation provider', () => {
    const python = participantPlan({
      adapter: 'node-preload',
      runtime: 'python',
      configured: true,
    });
    expect(() => participantTelemetry({ plan: python, bootstrap })).toThrow(
      'Activation for runtime "python" is unsupported',
    );
  });
});
