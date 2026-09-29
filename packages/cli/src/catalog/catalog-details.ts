import { resolve } from 'node:path';
import {
  loadCatalogFile,
  runCatalogList,
  type CatalogEntry,
  type CatalogListSuccess,
  type LoadedCatalog,
} from '@suites/blackbox-catalog-internal';

import { PackageFailure } from '../cli/failure.js';

export interface CatalogDetails {
  readonly list: CatalogListSuccess;
  readonly loaded: LoadedCatalog;
}

/** Loads the catalog; a catalog failure keeps its existing document and text. */
export async function loadCatalogDetails(projectDirectory: string): Promise<CatalogDetails> {
  const list = await runCatalogList({ projectDirectory });
  if (!list.ok) {
    throw new PackageFailure({
      document: list,
      text: list.diagnostics.map((d) => `${d.instancePath}: ${d.message}`).join('\n'),
    });
  }
  const loaded = await loadCatalogFile({
    configFile: resolve(projectDirectory, 'blackbox.config.yaml'),
  });
  return { list, loaded };
}

export async function tryLoadCatalogEntry(
  projectDirectory: string,
  system: string,
): Promise<CatalogEntry | null> {
  try {
    const loaded = await loadCatalogFile({
      configFile: resolve(projectDirectory, 'blackbox.config.yaml'),
    });
    return Object.hasOwn(loaded.config.catalog.entries, system)
      ? loaded.config.catalog.entries[system]
      : null;
  } catch {
    return null;
  }
}

/** The first catalog driver that speaks HTTP to the entrypoint participant, if any. */
export function entrypointHttpDriver(entry: CatalogEntry): string | null {
  const match = Object.entries(entry.drivers).find(
    ([, driver]) =>
      driver.target.participant === entry.entrypoint.participant &&
      driver.target.protocol === 'http',
  );
  return match === undefined ? null : match[0];
}
