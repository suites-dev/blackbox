import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli } from '../capsule/reporting/capsule-command.fixture.js';

function record(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, 'object');
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
}

async function localDriverSdk(directory: string): Promise<string> {
  const fixture = join(directory, 'driver-sdk');
  await mkdir(fixture, { recursive: true });
  await writeFile(
    join(fixture, 'package.json'),
    `${JSON.stringify({
      name: '@suites/blackbox-driver',
      version: '0.0.0-test',
      type: 'module',
      exports: './index.js',
    })}\n`,
  );
  await writeFile(join(fixture, 'index.js'), 'export const fixture = true;\n');
  return fixture;
}

void test('driver install runs npm offline and resolves the locally installed SDK', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blackbox-driver-install-'));
  try {
    const sdk = await localDriverSdk(root);
    const project = join(root, 'project');
    const drivers = join(project, '.blackbox', 'drivers');
    await mkdir(drivers, { recursive: true });
    await writeFile(
      join(drivers, 'package.json'),
      `${JSON.stringify({
        private: true,
        type: 'module',
        dependencies: { '@suites/blackbox-driver': `file:${sdk}` },
      })}\n`,
    );
    const first = await runCli({
      directory: project,
      argv: ['driver', 'install', '--runtime', 'node', '--json'],
    });
    assert.equal(first.status, 0, first.stderr);
    const result = record(JSON.parse(first.stdout) as unknown);
    const dependency = record(result.dependency);
    assert.equal(result.kind, 'driver-runtime-installation-succeeded');
    assert.equal(dependency.kind, 'driver-sdk-installed');
    assert.equal(dependency.spec, `file:${sdk}`);
    assert.equal(
      dependency.installationPath,
      join(await realpath(project), '.blackbox', 'drivers', 'node_modules', '@suites', 'blackbox-driver'),
    );
    const entrypoint = dependency.entrypoint;
    assert.equal(typeof entrypoint, 'string');
    if (typeof entrypoint !== 'string') {
      assert.fail('expected a resolved SDK entrypoint');
    }
    assert.equal(entrypoint, join(await realpath(sdk), 'index.js'));
    const installedPackage = record(
      JSON.parse(
        await readFile(
          join(drivers, 'node_modules', '@suites', 'blackbox-driver', 'package.json'),
          'utf8',
        ),
      ) as unknown,
    );
    assert.equal(
      installedPackage.name,
      '@suites/blackbox-driver',
    );

    const repeated = await runCli({
      directory: project,
      argv: ['driver', 'install', '--runtime', 'node', '--json'],
    });
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.deepEqual(JSON.parse(repeated.stdout).files, {
      kind: 'driver-runtime-files',
      package: 'retained',
      runtime: 'retained',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('driver install rejects unsupported runtimes without creating files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-driver-runtime-'));
  try {
    const result = await runCli({
      directory,
      argv: ['driver', 'install', '--runtime', 'python'],
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Expected --runtime=python to be one of: node/u);
    await assert.rejects(
      readFile(join(directory, '.blackbox', 'drivers', 'package.json')),
      /ENOENT/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test('JSON mode exposes a typed runtime-artifact conflict without running npm', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-driver-conflict-'));
  try {
    const drivers = join(directory, '.blackbox', 'drivers');
    await mkdir(drivers, { recursive: true });
    await writeFile(join(drivers, 'blackbox-driver-runtime.json'), '{"runtime":"custom"}\n');
    const result = await runCli({
      directory,
      argv: ['driver', 'install', '--runtime', 'node', '--json'],
    });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).failure.kind, 'driver-runtime-artifact-invalid');
    assert.equal(
      await readFile(join(drivers, 'blackbox-driver-runtime.json'), 'utf8'),
      '{"runtime":"custom"}\n',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
