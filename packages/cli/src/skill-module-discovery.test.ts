import assert from 'node:assert/strict';
import test from 'node:test';

import { loadCliSkillModules } from './skill-module-discovery.js';

function plugin(
  name: string,
  skills?: Readonly<{ apiVersion: number; export: string }>,
): { readonly name: string; readonly pjson: Record<string, unknown> } {
  return {
    name,
    pjson: skills === undefined ? {} : { blackbox: { skills } },
  };
}

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
