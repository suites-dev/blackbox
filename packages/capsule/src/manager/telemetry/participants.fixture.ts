import { resolveCatalogEntry, type LoadedCatalog } from '@suites/blackbox-catalog-internal';

import type { CapsuleManagerBootstrap } from '../../protocol.js';
import { catalogFixture } from '../testing/acquisition.fixture.js';

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
  };
}
