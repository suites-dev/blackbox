import type { CatalogListResult, CatalogValidateResult } from '@suites/blackbox-catalog-internal';

export interface CatalogOutput {
  readonly mode: 'json' | 'human';
  readonly result: CatalogListResult | CatalogValidateResult;
}
export function renderCatalogOutput(input: CatalogOutput): {
  readonly text: string;
  readonly failed: boolean;
} {
  const result = input.result;
  if (!result.ok) {
    return {
      text:
        input.mode === 'json'
          ? JSON.stringify(result)
          : result.diagnostics.map((d) => `${d.instancePath}: ${d.message}`).join('\n'),
      failed: true,
    };
  }
  if (result.operation === 'catalog.list') {
    return input.mode === 'json'
      ? {
          text: JSON.stringify({ default: result.defaultEntry, entries: result.entries }),
          failed: false,
        }
      : {
          text: result.entries.map((e) => `${e.id}${e.isDefault ? ' (default)' : ''}`).join('\n'),
          failed: false,
        };
  }
  return input.mode === 'json'
    ? { text: JSON.stringify(result), failed: false }
    : {
        text: `Catalog is valid: ${result.configFile}\nDefault: ${result.defaultEntry}\nEntries: ${result.entryCount}`,
        failed: false,
      };
}
