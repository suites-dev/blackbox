import type { CatalogValidationIssue, LoadedCatalog } from '../model/catalog-types.js';

/** An activation adapter that an installed runtime plugin provides for one runtime. */
export interface CatalogActivationAdapter {
  readonly runtime: string;
  readonly adapter: string;
}

export function isCatalogActivationAdapter(value: unknown): value is CatalogActivationAdapter {
  return (
    typeof value === 'object' &&
    value !== null &&
    'runtime' in value &&
    typeof value.runtime === 'string' &&
    'adapter' in value &&
    typeof value.adapter === 'string'
  );
}

function sortedEntries<Value>(record: Readonly<Record<string, Value>>): [string, Value][] {
  return Object.entries(record).sort(([left], [right]) => left.localeCompare(right));
}

function installedList(adapters: readonly CatalogActivationAdapter[]): string {
  return adapters.length === 0
    ? 'none'
    : adapters.map(({ adapter, runtime }) => `${adapter} (${runtime})`).join(', ');
}

/**
 * Acquisition installs an activation through the adapter registered for the
 * participant's runtime and adapter name, so a pair no installed plugin
 * provides would fail at the first acquisition.
 */
export function activationAdapterIssues(input: {
  readonly catalog: LoadedCatalog;
  readonly adapters: readonly CatalogActivationAdapter[];
}): readonly CatalogValidationIssue[] {
  const { config } = input.catalog;
  const issues: CatalogValidationIssue[] = [];
  for (const [entryId, entry] of sortedEntries(config.catalog.entries)) {
    for (const [participantId, participant] of sortedEntries(entry.participants)) {
      if (participant.activation.kind !== 'configured') {
        continue;
      }
      const activationId = participant.activation.activationId;
      const { adapter } = config.activations[activationId];
      if (
        input.adapters.some(
          (candidate) => candidate.adapter === adapter && candidate.runtime === participant.runtime,
        )
      ) {
        continue;
      }
      const path = `/catalog/entries/${entryId}/participants/${participantId}`;
      const runtimes = input.adapters
        .filter((candidate) => candidate.adapter === adapter)
        .map(({ runtime }) => JSON.stringify(runtime));
      issues.push(
        runtimes.length > 0
          ? {
              kind: 'semantic',
              instancePath: `${path}/runtime`,
              message:
                `runtime ${JSON.stringify(participant.runtime)} cannot use activation ` +
                `${JSON.stringify(activationId)}: adapter ${JSON.stringify(adapter)} activates ` +
                `runtime ${runtimes.join(', ')}`,
            }
          : {
              kind: 'semantic',
              instancePath: `${path}/activation`,
              message:
                `activation ${JSON.stringify(activationId)} uses adapter ${JSON.stringify(adapter)}, ` +
                `which no installed runtime plugin provides; installed adapters: ` +
                installedList(input.adapters),
            },
      );
    }
  }
  return issues;
}
