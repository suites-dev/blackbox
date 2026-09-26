import { describe, expect, it } from 'vitest';

import { createNodeRuntimeActivation, isNodeRuntimeActivationAdapter } from './activation.js';
import { nodeRuntimeProvider } from './provider.js';

describe('Node runtime activation', () => {
  it('loads the CommonJS bootstrap without inherited options', () => {
    expect(
      createNodeRuntimeActivation({
        kind: 'node-runtime-activation',
        adapter: 'node-preload',
        bootstrapPath: '/bundle/instrumentation.js',
        dependencyDirectory: '/bundle/node_modules',
        inheritedNodeOptions: { kind: 'absent' },
      }),
    ).toEqual({
      kind: 'node-runtime-activation-environment',
      adapter: 'node-preload',
      environment: { NODE_OPTIONS: '--require=/bundle/instrumentation.js' },
    });
  });

  it('preserves inherited options before the ESM loader and bootstrap', () => {
    const result = createNodeRuntimeActivation({
      kind: 'node-runtime-activation',
      adapter: 'node-esm',
      bootstrapPath: '/bundle/instrumentation.js',
      dependencyDirectory: '/bundle/node_modules',
      inheritedNodeOptions: { kind: 'present', value: ' --enable-source-maps ' },
    });
    expect(result.environment.NODE_OPTIONS).toBe(
      '--enable-source-maps ' +
        '--experimental-loader=/bundle/node_modules/@opentelemetry/instrumentation/hook.mjs ' +
        '--require=/bundle/instrumentation.js',
    );
  });

  it('accepts only adapters implemented by the runtime provider', () => {
    expect(isNodeRuntimeActivationAdapter('node-preload')).toBe(true);
    expect(isNodeRuntimeActivationAdapter('node-esm')).toBe(true);
    expect(isNodeRuntimeActivationAdapter('node-register')).toBe(false);
  });

  it('publishes CommonJS and ESM instructions from the same contract', () => {
    expect(nodeRuntimeProvider.activation.map(({ command }) => command)).toEqual([
      'NODE_OPTIONS="--require=./.blackbox/instrumentation/instrumentation.js" ' +
        'node <application.cjs>',
      'NODE_OPTIONS="--experimental-loader=./.blackbox/instrumentation/node_modules/' +
        '@opentelemetry/instrumentation/hook.mjs ' +
        '--require=./.blackbox/instrumentation/instrumentation.js" node <application.mjs>',
    ]);
  });
});
