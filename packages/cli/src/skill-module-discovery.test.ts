import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadCliSkillModules } from './skill-module-discovery.js';

function plugin(
  name: string,
  skills?: Readonly<{ apiVersion: number; export: string }>,
): { readonly name: string; readonly root: string; readonly pjson: Record<string, unknown> } {
  return {
    name,
    root: join(tmpdir(), 'blackbox-mocked-plugins', name),
    pjson: skills === undefined ? {} : { blackbox: { skills } },
  };
}

async function fixturePlugin(root: string, marker: string) {
  const name = '@blackbox-fixture/selected-plugin';
  const pjson = {
    name,
    type: 'module',
    exports: { './skills': './contribution.js' },
    blackbox: { skills: { apiVersion: 1, export: './skills' } },
  };
  const skillModule = { apiVersion: 1, packageName: name, skills: [], marker };
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify(pjson));
  await writeFile(
    join(root, 'contribution.js'),
    `export const skillModule = ${JSON.stringify(skillModule)};`,
  );
  return { plugin: { name, root, pjson }, skillModule };
}

void test('loads a selected ESM contribution outside the CLI dependency tree', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-detached-skill-plugin-'));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const selected = await fixturePlugin(join(directory, 'selected'), 'selected');

  assert.deepEqual(await loadCliSkillModules(new Map([[selected.plugin.name, selected.plugin]])), [
    selected.skillModule,
  ]);
});

void test('uses the selected plugin root instead of a same-named CLI dependency', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-shadowed-skill-plugin-'));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const selected = await fixturePlugin(join(directory, 'selected'), 'selected');
  const host = join(directory, 'host');
  await fixturePlugin(join(host, 'node_modules', selected.plugin.name), 'unselected-decoy');
  const isolatedLoader = join(host, 'skill-module-discovery.mjs');
  await copyFile(new URL('./skill-module-discovery.js', import.meta.url), isolatedLoader);
  const { loadCliSkillModules: loadFromHost } = createRequire(isolatedLoader)(isolatedLoader) as {
    readonly loadCliSkillModules: typeof loadCliSkillModules;
  };

  assert.deepEqual(await loadFromHost(new Map([[selected.plugin.name, selected.plugin]])), [
    selected.skillModule,
  ]);
});

void test('loads ESM contributions only from selected plugins that declare skills', async () => {
  const requested: string[] = [];
  const capsule = { apiVersion: 1, packageName: '@suites/blackbox-capsule', skills: [] };
  const modules = await loadCliSkillModules(
    new Map([
      ['plain', plugin('@suites/blackbox-plain')],
      ['capsule', plugin('@suites/blackbox-capsule', { apiVersion: 1, export: './skills' })],
    ]),
    (specifier) => {
      requested.push(specifier);
      return { skillModule: capsule };
    },
  );

  assert.deepEqual(requested, ['@suites/blackbox-capsule/skills']);
  assert.deepEqual(modules, [capsule]);
});

void test('does not import an unselected Capsule contribution', async () => {
  let imports = 0;
  const modules = await loadCliSkillModules(
    new Map([['skills', plugin('@suites/blackbox-skills', { apiVersion: 1, export: './skills' })]]),
    () => {
      imports += 1;
      return { skillModule: { apiVersion: 1, packageName: '@suites/blackbox-skills', skills: [] } };
    },
  );

  assert.equal(imports, 1);
  assert.equal(modules.length, 1);
  assert.equal(
    modules.some(
      (candidate) =>
        typeof candidate === 'object' &&
        candidate !== null &&
        (candidate as { packageName: unknown }).packageName === '@suites/blackbox-capsule',
    ),
    false,
  );
});

void test('rejects unsupported manifests and missing named exports', async () => {
  await assert.rejects(
    loadCliSkillModules(
      new Map([
        ['capsule', plugin('@suites/blackbox-capsule', { apiVersion: 2, export: './skills' })],
      ]),
    ),
    /unsupported skill module manifest/u,
  );
  await assert.rejects(
    loadCliSkillModules(
      new Map([
        ['capsule', plugin('@suites/blackbox-capsule', { apiVersion: 1, export: './skills' })],
      ]),
      () => ({}),
    ),
    /did not export skillModule/u,
  );
});
