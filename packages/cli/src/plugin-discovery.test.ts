import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { discoverProjectCliPlugins } from './plugin-discovery.js';

async function projectFixture(): Promise<string> {
  const project = await mkdtemp(join(tmpdir(), 'blackbox-cli-plugin-discovery-'));
  await mkdir(join(project, 'node_modules', '@suites', 'blackbox-zeta'), { recursive: true });
  await mkdir(join(project, 'node_modules', '@suites', 'blackbox-plain'), { recursive: true });
  await writeFile(
    join(project, 'package.json'),
    `${JSON.stringify({
      name: 'fixture',
      dependencies: {
        '@suites/blackbox-zeta': 'workspace:*',
        '@suites/blackbox-plain': 'workspace:*',
      },
    })}\n`,
  );
  await writeFile(
    join(project, 'node_modules', '@suites', 'blackbox-zeta', 'package.json'),
    `${JSON.stringify({
      name: '@suites/blackbox-zeta',
      type: 'module',
      main: 'index.js',
      blackbox: { cli: { apiVersion: 1, pluginId: 'zeta', topic: 'zeta' } },
      oclif: { topics: { zeta: { description: 'Commands from the selected plugin.' } } },
    })}\n`,
  );
  await writeFile(
    join(project, 'node_modules', '@suites', 'blackbox-plain', 'package.json'),
    `${JSON.stringify({ name: '@suites/blackbox-plain', type: 'module', main: 'index.js' })}\n`,
  );
  await writeFile(join(project, 'node_modules', '@suites', 'blackbox-zeta', 'index.js'), '');
  await writeFile(join(project, 'node_modules', '@suites', 'blackbox-plain', 'index.js'), '');
  return project;
}

void test('discovers only package-owned CLI plugins declared by the project', async () => {
  const project = await projectFixture();
  const result = await discoverProjectCliPlugins(project);
  if (result === null) {
    throw new Error('expected a project plugin result');
  }
  assert.deepEqual(result.names, ['@suites/blackbox-zeta']);
  const selected = result.packages[0];
  assert.ok(selected);
  const oclif = selected.pjson.oclif;
  assert.ok(oclif && typeof oclif === 'object' && !Array.isArray(oclif));
  assert.deepEqual((oclif as Record<string, unknown>).topics, {
    zeta: { description: 'Commands from the selected plugin.' },
  });
});

void test('the CLI host does not declare selected plugins or their topics', async () => {
  const manifest = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.oclif.topics, undefined);
  assert.equal(manifest.blackbox, undefined);
});

void test('discovers consumer plugins above an installed CLI package, not its build dependencies', async (t) => {
  const consumer = await mkdtemp(join(tmpdir(), 'blackbox-cli-installed-discovery-'));
  t.after(async () => rm(consumer, { recursive: true, force: true }));
  const pluginDirectory = join(consumer, 'node_modules', '@suites', 'blackbox-zeta');
  const cliDirectory = join(consumer, 'node_modules', '@suites', 'blackbox-cli');
  await mkdir(pluginDirectory, { recursive: true });
  await mkdir(cliDirectory, { recursive: true });
  await mkdir(join(consumer, 'workspace'), { recursive: true });
  await writeFile(
    join(consumer, 'package.json'),
    `${JSON.stringify({
      name: 'consumer',
      dependencies: { '@suites/blackbox-zeta': 'file:plugin.tgz' },
    })}\n`,
  );
  await writeFile(
    join(pluginDirectory, 'package.json'),
    `${JSON.stringify({
      name: '@suites/blackbox-zeta',
      type: 'module',
      main: 'index.js',
      blackbox: { cli: { apiVersion: 1, pluginId: 'zeta', topic: 'zeta' } },
    })}\n`,
  );
  await writeFile(join(pluginDirectory, 'index.js'), '');
  await writeFile(
    join(cliDirectory, 'package.json'),
    `${JSON.stringify({
      name: '@suites/blackbox-cli',
      devDependencies: { '@suites/blackbox-build-only': '1.0.0' },
    })}\n`,
  );
  const buildPlugin = join(cliDirectory, 'node_modules', '@suites', 'blackbox-build-only');
  await mkdir(buildPlugin, { recursive: true });
  await writeFile(
    join(buildPlugin, 'package.json'),
    JSON.stringify({
      name: '@suites/blackbox-build-only',
      type: 'module',
      main: 'index.js',
      blackbox: { cli: { apiVersion: 1, pluginId: 'build-only', topic: 'build-only' } },
    }),
  );
  await writeFile(join(buildPlugin, 'index.js'), '');
  const result = await discoverProjectCliPlugins(join(consumer, 'workspace'), cliDirectory);
  if (result === null) {
    throw new Error('expected the consumer plugin result');
  }
  assert.equal(result.path, consumer);
  assert.deepEqual(result.names, ['@suites/blackbox-zeta']);
});

void test('does not classify an unrelated pnpm workspace as the Blackbox source checkout', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'blackbox-cli-unrelated-workspace-'));
  await mkdir(join(workspace, 'packages', 'cli'), { recursive: true });
  await mkdir(join(workspace, 'node_modules', '@suites', 'blackbox-zeta'), { recursive: true });
  await writeFile(join(workspace, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
  await writeFile(
    join(workspace, 'package.json'),
    `${JSON.stringify({
      name: 'consumer-workspace',
      dependencies: { '@suites/blackbox-zeta': 'file:plugin.tgz' },
    })}\n`,
  );
  await writeFile(join(workspace, 'packages', 'cli', 'package.json'), '{"name":"cli"}\n');
  await writeFile(
    join(workspace, 'node_modules', '@suites', 'blackbox-zeta', 'package.json'),
    `${JSON.stringify({
      name: '@suites/blackbox-zeta',
      type: 'module',
      main: 'index.js',
      blackbox: { cli: { apiVersion: 1, pluginId: 'zeta', topic: 'zeta' } },
    })}\n`,
  );
  await writeFile(join(workspace, 'node_modules', '@suites', 'blackbox-zeta', 'index.js'), '');

  const result = await discoverProjectCliPlugins(
    join(workspace, 'packages', 'cli'),
    join(workspace, 'packages', 'cli'),
  );
  if (result === null) {
    throw new Error('expected an installed consumer result');
  }
  assert.equal(result.kind, 'installed-consumer');
});
