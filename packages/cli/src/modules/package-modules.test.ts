import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { selectPackageModules } from './package-modules.js';
import { discoverProjectCliPlugins } from '../plugin-discovery.js';

async function fixture(t: TestContext): Promise<string> {
  const project = await realpath(await mkdtemp(join(tmpdir(), 'blackbox-package-modules-')));
  t.after(async () => rm(project, { recursive: true, force: true }));
  await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'consumer' }));
  return project;
}

async function putPackage(
  owner: string,
  name: string,
  options: Readonly<Record<string, unknown>> = {},
): Promise<string> {
  const root = join(owner, 'node_modules', name);
  await mkdir(root, { recursive: true });
  const dependencies = Array.isArray(options.dependencies) ? options.dependencies : [];
  const declared = Array.isArray(options.declared) ? options.declared : dependencies;
  const blackbox =
    options.blackbox ??
    (options.dependencies === undefined
      ? { skills: { apiVersion: 1, export: './skills' } }
      : { module: { apiVersion: 1, export: './module' } });
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      type: 'module',
      blackbox,
      exports: { '.': './index.js', './module': { import: './module.js', require: './decoy.cjs' } },
      dependencies: Object.fromEntries(declared.map((dependency) => [dependency, '1.0.0'])),
    }),
  );
  await writeFile(join(root, 'index.js'), 'export {};');
  await writeFile(
    join(root, 'module.js'),
    `export const blackboxModule = await Promise.resolve(${JSON.stringify(options.module ?? { apiVersion: 1, dependencies: options.dependencies ?? [] })});`,
  );
  await writeFile(join(root, 'decoy.cjs'), 'throw new Error("require condition was selected");');
  return root;
}

void test('expands explicit ESM modules from their own dependencies without activating other transitive packages', async (t) => {
  const project = await fixture(t);
  const main = await putPackage(project, '@suites/blackbox', {
    dependencies: ['@third-party/catalog', '@third-party/skills-only'],
    declared: ['@third-party/catalog', '@third-party/skills-only', '@suites/blackbox-capsule'],
  });
  const catalog = await putPackage(main, '@third-party/catalog', {
    blackbox: { cli: { apiVersion: 1, pluginId: 'catalog', topic: 'catalog' } },
  });
  await putPackage(main, '@third-party/skills-only');
  await putPackage(main, '@suites/blackbox-capsule');
  const selected = await selectPackageModules(project, ['@suites/blackbox']);
  assert.deepEqual(
    selected.map(({ name }) => name),
    ['@suites/blackbox', '@third-party/catalog', '@third-party/skills-only'],
  );
  const selectedCatalog = selected.find(({ name }) => name === '@third-party/catalog');
  assert.ok(selectedCatalog);
  assert.equal(selectedCatalog.root, catalog);
  assert.equal(
    selected.some(({ pjson }) => pjson.oclif !== undefined),
    false,
  );
});

void test('deduplicates the same module selected both directly and by a bundle', async (t) => {
  const project = await fixture(t);
  await putPackage(project, 'bundle', { dependencies: ['shared'] });
  await putPackage(project, 'shared');
  assert.deepEqual(
    (await selectPackageModules(project, ['bundle', 'shared'])).map(({ name }) => name),
    ['bundle', 'shared'],
  );
});

void test('missing optional selections are absent but a missing required bundle module fails closed', async (t) => {
  const project = await fixture(t);
  assert.deepEqual(await selectPackageModules(project, ['absent']), []);
  await putPackage(project, 'bundle', { dependencies: ['absent'] });
  await assert.rejects(
    selectPackageModules(project, ['bundle']),
    /Required Blackbox module absent is unavailable/u,
  );
});

void test('rejects dependencies not owned by the contributing package and path-like package names', async (t) => {
  const project = await fixture(t);
  await putPackage(project, 'ambient');
  await putPackage(project, 'bundle', { dependencies: ['ambient'], declared: [] });
  await assert.rejects(
    selectPackageModules(project, ['bundle']),
    /activates undeclared dependency ambient/u,
  );
  await assert.rejects(
    selectPackageModules(project, ['../ambient']),
    /Invalid Blackbox module package name/u,
  );
});

void test('rejects unsupported module manifests and malformed public exports', async (t) => {
  const project = await fixture(t);
  await putPackage(project, 'unsupported', {
    blackbox: { module: { apiVersion: 2, export: './module' } },
  });
  await putPackage(project, 'malformed', {
    dependencies: [],
    module: { apiVersion: 1, dependencies: [123] },
  });
  await assert.rejects(
    selectPackageModules(project, ['unsupported']),
    /Unsupported Blackbox module manifest/u,
  );
  await assert.rejects(
    selectPackageModules(project, ['malformed']),
    /Invalid blackboxModule export/u,
  );
});

void test('rejects module cycles and competing installations instead of choosing silently', async (t) => {
  const project = await fixture(t);
  await putPackage(project, 'cycle-a', { dependencies: ['cycle-b'] });
  await putPackage(project, 'cycle-b', { dependencies: ['cycle-a'] });
  await assert.rejects(selectPackageModules(project, ['cycle-a']), /dependency cycle/u);
  const bundle = await putPackage(project, 'bundle', { dependencies: ['shared'] });
  await putPackage(bundle, 'shared');
  await putPackage(project, 'shared');
  await assert.rejects(
    selectPackageModules(project, ['bundle', 'shared']),
    /Conflicting Blackbox module installations/u,
  );
});

void test('the main package is not mistaken for the consumer composition root', async (t) => {
  const project = await fixture(t);
  await writeFile(
    join(project, 'package.json'),
    JSON.stringify({ name: 'consumer', devDependencies: { '@suites/blackbox': '1.0.0' } }),
  );
  const main = await putPackage(project, '@suites/blackbox', {
    dependencies: ['core'],
    declared: ['core', 'not-selected'],
  });
  await putPackage(main, 'core');
  await putPackage(main, 'not-selected');
  const selected = await discoverProjectCliPlugins(project, main);
  assert.ok(selected);
  assert.equal(selected.path, project);
  assert.deepEqual(selected.names, ['@suites/blackbox', 'core']);
});

void test('does not execute modules from an unrelated working directory', async (t) => {
  const project = await fixture(t);
  await writeFile(
    join(project, 'package.json'),
    JSON.stringify({
      name: 'consumer',
      dependencies: { bundle: '1.0.0' },
    }),
  );
  const bundle = await putPackage(project, 'bundle', { dependencies: [] });
  const other = await fixture(t);
  await writeFile(
    join(other, 'package.json'),
    JSON.stringify({
      name: 'other-project',
      dependencies: { foreign: '1.0.0' },
    }),
  );
  const foreign = await putPackage(other, 'foreign', { dependencies: [] });
  await writeFile(join(foreign, 'module.js'), 'throw new Error("unselected module executed");');

  const selected = await discoverProjectCliPlugins(other, bundle);
  assert.ok(selected);
  assert.equal(selected.path, project);
  assert.deepEqual(selected.names, ['bundle']);
});
