import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import type { LoadedCatalog } from '../model/catalog-types.js';
import { validCatalogDocument } from '../test-fixtures/catalog-document.js';
import { validateReferencedInputs } from './referenced-inputs.js';

function catalogAt(
  projectDirectory: string,
  composeFile: string,
  activationFile: string,
): LoadedCatalog {
  const base = validCatalogDocument();
  const orders = base.catalog.entries.orders;
  return {
    sourceFile: join(projectDirectory, 'blackbox.config.yaml'),
    projectDirectory,
    config: {
      ...base,
      catalog: {
        ...base.catalog,
        entries: {
          orders: {
            ...orders,
            acquisition: { ...orders.acquisition, files: [composeFile] },
          },
        },
      },
      activations: {
        'node-runtime': { ...base.activations['node-runtime'], ref: activationFile },
      },
      clients: {},
    },
  };
}

it('reports missing activation references after a valid Compose reference', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'blackbox-catalog-activation-'));
  await mkdir(join(projectDirectory, '.blackbox/catalog'), { recursive: true });
  await writeFile(join(projectDirectory, '.blackbox/catalog/orders.yml'), 'services: {}\n');
  const catalog = catalogAt(
    projectDirectory,
    '.blackbox/catalog/orders.yml',
    '.blackbox/instrumentation/missing.mjs',
  );
  await expect(validateReferencedInputs({ catalog })).resolves.toEqual([
    {
      kind: 'semantic',
      instancePath: '/activations/node-runtime/ref',
      message: 'referenced file does not exist: .blackbox/instrumentation/missing.mjs',
    },
  ]);
});

it('rejects directory references and symlinks that resolve outside the project', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'blackbox-catalog-contained-'));
  const externalDirectory = await mkdtemp(join(tmpdir(), 'blackbox-catalog-external-'));
  await mkdir(join(projectDirectory, '.blackbox/catalog'), { recursive: true });
  await writeFile(join(externalDirectory, 'outside.mjs'), 'export {};\n');
  await symlink(
    join(externalDirectory, 'outside.mjs'),
    join(projectDirectory, '.blackbox/catalog/outside.mjs'),
  );
  const catalog = catalogAt(projectDirectory, '.blackbox/catalog', '.blackbox/catalog/outside.mjs');
  await expect(validateReferencedInputs({ catalog })).resolves.toEqual([
    {
      kind: 'semantic',
      instancePath: '/catalog/entries/orders/acquisition/files/0',
      message: 'must refer to a file: .blackbox/catalog',
    },
    {
      kind: 'semantic',
      instancePath: '/activations/node-runtime/ref',
      message: 'resolves outside the project directory: .blackbox/catalog/outside.mjs',
    },
  ]);
});

it('reports a missing project-authored client module', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'blackbox-catalog-client-'));
  await mkdir(join(projectDirectory, '.blackbox/catalog'), { recursive: true });
  await mkdir(join(projectDirectory, '.blackbox/instrumentation'), { recursive: true });
  await Promise.all([
    writeFile(join(projectDirectory, '.blackbox/catalog/orders.yml'), 'services: {}\n'),
    writeFile(join(projectDirectory, '.blackbox/instrumentation/node.mjs'), 'export {};\n'),
  ]);
  const catalog = catalogAt(
    projectDirectory,
    '.blackbox/catalog/orders.yml',
    '.blackbox/instrumentation/node.mjs',
  );
  const withClient = {
    ...catalog,
    config: {
      ...catalog.config,
      clients: {
        orders: {
          ref: '.blackbox/clients/missing.mjs',
          target: { kind: 'entrypoint' },
        },
      },
    },
  } satisfies LoadedCatalog;

  await expect(validateReferencedInputs({ catalog: withClient })).resolves.toEqual([
    {
      kind: 'semantic',
      instancePath: '/clients/orders/ref',
      message: 'referenced file does not exist: .blackbox/clients/missing.mjs',
    },
  ]);
});
