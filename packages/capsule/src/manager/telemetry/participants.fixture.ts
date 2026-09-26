import { resolveCatalogEntry, type LoadedCatalog } from '@suites/blackbox-catalog-internal';
import type { RuntimeActivationAdapter } from '@suites/blackbox-instrumentation-internal';

import type { CapsuleManagerBootstrap } from '../../protocol.js';
import { catalogFixture } from '../testing/acquisition.fixture.js';

const nodeAdapters = [
  {
    kind: 'runtime-activation-adapter',
    runtime: 'node',
    adapter: 'node-preload',
    sourceDirectoryRelativePath: '.blackbox/instrumentation',
    targetDirectory: '/blackbox/instrumentation',
    environment: {
      kind: 'append-environment-variable',
      name: 'NODE_OPTIONS',
      separator: ' ',
      value: [{ kind: 'activation-asset-path', prefix: '--require=' }],
    },
  },
  {
    kind: 'runtime-activation-adapter',
    runtime: 'node',
    adapter: 'node-esm',
    sourceDirectoryRelativePath: '.blackbox/instrumentation',
    targetDirectory: '/blackbox/instrumentation',
    environment: {
      kind: 'append-environment-variable',
      name: 'NODE_OPTIONS',
      separator: ' ',
      value: [
        {
          kind: 'mounted-relative-path',
          prefix: '--experimental-loader=',
          relativePath: 'node_modules/@opentelemetry/instrumentation/hook.mjs',
        },
        { kind: 'activation-asset-path', prefix: '--require=' },
      ],
    },
  },
] as const satisfies readonly RuntimeActivationAdapter[];

export function participantPlan(input: {
  readonly adapter: string;
  readonly runtime: string;
  readonly configured: boolean;
  readonly projectDirectory: string;
}) {
  const base = catalogFixture(input.projectDirectory);
  const entry = base.config.catalog.entries.orders;
  const activation = input.configured
    ? { kind: 'configured' as const, activationId: 'node' }
    : { kind: 'unconfigured' as const };
  const catalog = {
    ...base,
    config: {
      ...base.config,
      activations: {
        node: {
          ref: '.blackbox/instrumentation/instrumentation.js',
          adapter: input.adapter,
          version: 1,
        },
      },
      catalog: {
        ...base.config.catalog,
        entries: {
          orders: {
            ...entry,
            participants: {
              api: { ...entry.participants.api, runtime: input.runtime, activation },
            },
          },
        },
      },
    },
  } satisfies LoadedCatalog;
  return resolveCatalogEntry({
    catalog,
    selection: { kind: 'explicit-entry', entryId: 'orders' },
  });
}

export function participantBootstrap(
  environment: Readonly<Record<string, string>>,
): CapsuleManagerBootstrap {
  return {
    projectDirectory: '/tmp/project',
    sessionId: 'quiet-river-ada',
    executionId: 'execution-1',
    systemId: 'orders',
    environment,
    runtimeActivationAdapters: nodeAdapters,
  };
}
