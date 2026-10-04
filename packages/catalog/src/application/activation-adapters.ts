import { unavailableRuntimeActivationAdapterMessage } from '@suites/blackbox-instrumentation';

import type {
  BlackboxConfig,
  CatalogEntry,
  CatalogValidationIssue,
} from '../model/catalog-types.js';
import type {
  CatalogActivationAdapters,
  CatalogRuntimeActivationAdapter,
} from './catalog-command-types.js';

function entryIssues(input: {
  readonly config: BlackboxConfig;
  readonly entryId: string;
  readonly entry: CatalogEntry;
  readonly adapters: readonly CatalogRuntimeActivationAdapter[];
}): CatalogValidationIssue[] {
  const issues: CatalogValidationIssue[] = [];
  for (const [participantId, participant] of Object.entries(input.entry.participants)) {
    if (participant.activation.kind === 'unconfigured') {
      continue;
    }
    const { adapter } = input.config.activations[participant.activation.activationId];
    const runtime = participant.runtime;
    if (!input.adapters.some((c) => c.runtime === runtime && c.adapter === adapter)) {
      issues.push({
        kind: 'semantic',
        instancePath: `/catalog/entries/${input.entryId}/participants/${participantId}/activation`,
        message: unavailableRuntimeActivationAdapterMessage({ runtime, adapter }),
      });
    }
  }
  return issues;
}

/**
 * Participants whose activation no installed adapter loads for their runtime. Capsule startup
 * and Playwright setup refuse the same participants with the same message.
 */
export function unavailableActivationAdapterIssues(input: {
  readonly config: BlackboxConfig;
  readonly adapters: readonly CatalogRuntimeActivationAdapter[];
}): CatalogValidationIssue[] {
  return Object.entries(input.config.catalog.entries).flatMap(([entryId, entry]) =>
    entryIssues({ config: input.config, entryId, entry, adapters: input.adapters }),
  );
}

/**
 * The check for the adapters the CLI plugins registered. With none registered there is no runtime
 * plugin to compare against (a Playwright project, for one, brings its own), so nothing is checked.
 */
export function registeredActivationAdapters(
  adapters: readonly CatalogRuntimeActivationAdapter[],
): CatalogActivationAdapters {
  return adapters.length === 0 ? { kind: 'not-checked' } : { kind: 'installed', adapters };
}
