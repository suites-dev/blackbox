import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
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
});

void test('discovers consumer plugins above an installed CLI package', async () => {
  const consumer = await mkdtemp(join(tmpdir(), 'blackbox-cli-installed-discovery-'));
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
  await writeFile(join(cliDirectory, 'package.json'), `${JSON.stringify({ name: '@suites/blackbox-cli' })}\n`);
  const result = await discoverProjectCliPlugins(
    join(consumer, 'workspace'),
    cliDirectory,
  );
  if (result === null) {
    throw new Error('expected the consumer plugin result');
  }
  assert.equal(result.path, consumer);
  assert.deepEqual(result.names, ['@suites/blackbox-zeta']);
});
