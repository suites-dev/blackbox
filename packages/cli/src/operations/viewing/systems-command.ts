import type { CatalogEntry } from '@suites/blackbox-catalog-internal';

import { BlackboxCommand } from '../../cli/base-command.js';
import { EXIT_CODES } from '../../cli/exit-codes.js';
import { formatColumns } from '../../cli/output.js';
import { loadCatalogDetails } from '../../catalog/catalog-details.js';

export interface SystemRow {
  readonly name: string;
  readonly entry: CatalogEntry;
  readonly isDefault: boolean;
}

export function systemsLines(rows: readonly SystemRow[]): readonly string[] {
  return formatColumns([
    ['NAME', 'KIND', 'SERVICES', 'ENTRYPOINT'],
    ...rows.map(({ name, entry, isDefault }) => [
      name,
      entry.kind,
      String(Object.keys(entry.participants).length),
      `${entry.entrypoint.participant} (${entry.entrypoint.protocol})`,
      ...(isDefault ? ['default'] : []),
    ]),
  ]);
}

/** `systems` and its `catalog list` alias. Never needs a current capsule. */
export abstract class SystemsCommand extends BlackboxCommand {
  protected async executeSystems(input: { readonly json: boolean }): Promise<void> {
    const { list, loaded } = await loadCatalogDetails(process.cwd());
    if (input.json) {
      this.json({ default: list.defaultEntry, entries: list.entries, next: [] });
    } else {
      this.human(
        systemsLines(
          list.entries.map((summary) => ({
            name: summary.id,
            entry: loaded.config.catalog.entries[summary.id],
            isDefault: summary.isDefault,
          })),
        ),
      );
    }
    this.finish(EXIT_CODES.success);
  }
}
