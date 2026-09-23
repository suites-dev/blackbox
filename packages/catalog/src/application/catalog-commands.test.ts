import { mkdir, mkdtemp, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

import { runCatalogList, runCatalogValidate } from './catalog-commands.js';

const validCatalog = `schemaVersion: 1
catalog:
  default: orders
  entries:
    orders:
      kind: system
      acquisition:
        adapter: docker-compose@1
        files: [.blackbox/compose/orders.yml]
      isolation: per-test
      entrypoint:
        participant: api
        protocol: http
        containerPort: 3000
        readiness: { path: /health, timeoutMs: 60000 }
      participants:
        api: { service: api, role: entrypoint, runtime: node, activation: node-runtime }
      observation:
        policyId: orders-v1
        boundaries:
          - { id: effects.http, kind: http, authoritativeFor: [HTTP effects] }
        requiredBoundaries: [effects.http]
        terminalObservationWindowMs: 1000
        redaction:
          requestBodies: not-captured
          headers: [authorization]
          dynamicIdentifiers: normalized
activations:
  node-runtime:
    ref: .blackbox/instrumentation/bootstrap.mjs
    adapter: node-factory
    version: 1
`;

async function makeValidProject(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-catalog-command-'));
  await mkdir(join(directory, '.blackbox/compose'), { recursive: true });
  await mkdir(join(directory, '.blackbox/instrumentation'), { recursive: true });
  await Promise.all([
    writeFile(join(directory, 'blackbox.config.yaml'), validCatalog, 'utf8'),
    writeFile(join(directory, '.blackbox/compose/orders.yml'), 'services: {}\n', 'utf8'),
    writeFile(join(directory, '.blackbox/instrumentation/bootstrap.mjs'), 'export {};\n', 'utf8'),
  ]);
  return directory;
}

it('validates the canonical project-root configuration and referenced files', async () => {
  const projectDirectory = await makeValidProject();

  await expect(runCatalogValidate({ projectDirectory })).resolves.toEqual({
    kind: 'catalog-validate-success',
    ok: true,
    operation: 'catalog.validate',
    exitClass: 'success',
    configFile: join(projectDirectory, 'blackbox.config.yaml'),
    schemaVersion: 1,
    defaultEntry: 'orders',
    entryCount: 1,
  });
});

it('returns structured invalid-config diagnostics without printing or exiting', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'blackbox-catalog-invalid-'));
  await writeFile(
    join(projectDirectory, 'blackbox.config.yaml'),
    'schemaVersion: 1\ncatalog: []\nactivations: {}\n',
    'utf8',
  );

  const result = await runCatalogValidate({ projectDirectory });
  expect(result).toMatchObject({
    ok: false,
    kind: 'catalog-command-user-error',
    operation: 'catalog.validate',
    exitClass: 'user-error',
    classification: 'config-invalid',
    configFile: join(projectDirectory, 'blackbox.config.yaml'),
    diagnostics: [expect.objectContaining({ kind: 'schema', instancePath: '/catalog' })],
  });
});

it('classifies a missing canonical configuration for validate and list', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'blackbox-catalog-missing-'));

  const [validateResult, listResult] = await Promise.all([
    runCatalogValidate({ projectDirectory }),
    runCatalogList({ projectDirectory }),
  ]);
  expect(validateResult).toMatchObject({
    ok: false,
    kind: 'catalog-command-user-error',
    operation: 'catalog.validate',
    exitClass: 'user-error',
    classification: 'config-missing',
  });
  expect(listResult).toMatchObject({
    ok: false,
    kind: 'catalog-command-user-error',
    operation: 'catalog.list',
    exitClass: 'user-error',
    classification: 'config-missing',
  });
});

it('classifies an unreadable project location as an operational failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-catalog-not-directory-'));
  const projectDirectory = join(directory, 'regular-file');
  await writeFile(projectDirectory, 'not a directory\n');

  await expect(runCatalogValidate({ projectDirectory })).resolves.toMatchObject({
    kind: 'catalog-command-operational-error',
    ok: false,
    operation: 'catalog.validate',
    exitClass: 'operational-error',
    classification: 'filesystem-error',
  });
});

it('rejects a valid catalog whose Compose file is missing', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'blackbox-catalog-reference-'));
  await mkdir(join(projectDirectory, '.blackbox/instrumentation'), { recursive: true });
  await Promise.all([
    writeFile(join(projectDirectory, 'blackbox.config.yaml'), validCatalog, 'utf8'),
    writeFile(join(projectDirectory, '.blackbox/instrumentation/bootstrap.mjs'), 'export {};\n'),
  ]);

  const result = await runCatalogValidate({ projectDirectory });
  expect(result).toEqual({
    ok: false,
    kind: 'catalog-command-user-error',
    operation: 'catalog.validate',
    exitClass: 'user-error',
    classification: 'referenced-input-invalid',
    configFile: join(projectDirectory, 'blackbox.config.yaml'),
    diagnostics: [
      {
        kind: 'semantic',
        instancePath: '/catalog/entries/orders/acquisition/files/0',
        message: 'referenced file does not exist: .blackbox/compose/orders.yml',
      },
    ],
  });
  await expect(runCatalogList({ projectDirectory })).resolves.toMatchObject({
    kind: 'catalog-list-success',
    ok: true,
    defaultEntry: 'orders',
  });
});

it('classifies an uninspectable reference as an operational failure', async () => {
  const projectDirectory = await makeValidProject();
  const composeFile = join(projectDirectory, '.blackbox/compose/orders.yml');
  await writeFile(composeFile, 'services: {}\n');
  const loop = join(projectDirectory, '.blackbox/instrumentation/bootstrap.mjs');
  await writeFile(loop, '');
  await unlink(loop);
  await symlink(loop, loop);

  await expect(runCatalogValidate({ projectDirectory })).resolves.toMatchObject({
    kind: 'catalog-command-operational-error',
    ok: false,
    operation: 'catalog.validate',
    exitClass: 'operational-error',
    classification: 'filesystem-error',
  });
});

it('returns deterministic JSON-ready list output', async () => {
  const e2eProject = fileURLToPath(new URL('../../../../e2e', import.meta.url));

  await expect(runCatalogList({ projectDirectory: e2eProject })).resolves.toEqual({
    kind: 'catalog-list-success',
    ok: true,
    operation: 'catalog.list',
    exitClass: 'success',
    configFile: join(e2eProject, 'blackbox.config.yaml'),
    defaultEntry: 'subscription-system',
    entries: [
      { id: 'payment-mock', kind: 'subsystem', isDefault: false },
      { id: 'payment-mock-dist', kind: 'subsystem', isDefault: false },
      { id: 'subscription-system', kind: 'system', isDefault: true },
    ],
  });
});

it('validates every reference in the current E2E catalog', async () => {
  const projectDirectory = fileURLToPath(new URL('../../../../e2e', import.meta.url));
  await expect(runCatalogValidate({ projectDirectory })).resolves.toMatchObject({
    kind: 'catalog-validate-success',
    ok: true,
    operation: 'catalog.validate',
  });
});
