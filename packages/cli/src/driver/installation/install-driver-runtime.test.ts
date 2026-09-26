import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { decodeDriverRuntimeArtifact } from '@suites/blackbox-driver';

import { installDriverRuntime } from './install-driver-runtime.js';
import type { PackageManagerInstaller } from './types.js';

const succeeded = {
  kind: 'package-manager-install-succeeded',
  packageManager: 'npm',
  exitCode: 0,
  stderr: '',
} as const;

async function materializeSdk(directory: string): Promise<void> {
  const target = join(directory, 'node_modules', '@suites', 'blackbox-driver');
  await mkdir(target, { recursive: true });
  await writeFile(
    join(target, 'package.json'),
    '{"name":"@suites/blackbox-driver","type":"module","exports":"./index.js"}\n',
  );
  await writeFile(join(target, 'index.js'), 'export {};\n');
}

const successfulInstaller: PackageManagerInstaller = async ({ directory }) => {
  await materializeSdk(directory);
  return succeeded;
};

void test('preserves authored package fields and installs only declared dependencies', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'driver-install-domain-'));
  try {
    const drivers = join(projectDirectory, '.blackbox', 'drivers');
    await mkdir(drivers, { recursive: true });
    await writeFile(
      join(drivers, 'package.json'),
      '{"private":true,"scripts":{"inspect":"node inspect.js"},"dependencies":{"pg":"8.16.3"}}\n',
    );
    const first = await installDriverRuntime({
      projectDirectory,
      packageManager: successfulInstaller,
    });
    if (!first.ok) {
      assert.fail(first.message);
    }
    assert.equal(first.kind, 'driver-runtime-installation-succeeded');
    assert.deepEqual(first.files, {
      kind: 'driver-runtime-files',
      package: 'updated',
      runtime: 'created',
    });
    const manifest = JSON.parse(await readFile(join(drivers, 'package.json'), 'utf8'));
    assert.deepEqual(manifest.scripts, { inspect: 'node inspect.js' });
    assert.deepEqual(manifest.dependencies, {
      pg: '8.16.3',
      '@suites/blackbox-driver': '0.0.0',
    });
    assert.equal('curl' in manifest.dependencies, false);
    assert.equal('psql' in manifest.dependencies, false);
    const runtime = await readFile(join(drivers, 'blackbox-driver-runtime.json'), 'utf8');
    assert.equal(decodeDriverRuntimeArtifact(runtime).runtime, 'node');

    const repeated = await installDriverRuntime({
      projectDirectory,
      packageManager: successfulInstaller,
    });
    if (!repeated.ok) {
      assert.fail(repeated.message);
    }
    assert.equal(repeated.kind, 'driver-runtime-installation-succeeded');
    assert.deepEqual(repeated.files, {
      kind: 'driver-runtime-files',
      package: 'retained',
      runtime: 'retained',
    });
  } finally {
    await rm(projectDirectory, { recursive: true, force: true });
  }
});

void test('classifies failed installs and successful installs without a resolvable SDK', async () => {
  const failedProject = await mkdtemp(join(tmpdir(), 'driver-install-failed-'));
  const unresolvedProject = await mkdtemp(join(tmpdir(), 'driver-install-unresolved-'));
  try {
    const failed = await installDriverRuntime({
      projectDirectory: failedProject,
      packageManager: () =>
        Promise.resolve({
          kind: 'package-manager-install-failed',
          packageManager: 'npm',
          exitCode: 17,
          stderr: 'offline package missing',
        }),
    });
    assert.equal(failed.kind, 'driver-runtime-installation-failed');
    assert.equal(failed.failure.kind, 'driver-package-manager-failed');

    const unresolved = await installDriverRuntime({
      projectDirectory: unresolvedProject,
      packageManager: () => Promise.resolve(succeeded),
    });
    assert.equal(unresolved.kind, 'driver-runtime-installation-failed');
    assert.equal(unresolved.failure.kind, 'driver-sdk-unresolved');
  } finally {
    await rm(failedProject, { recursive: true, force: true });
    await rm(unresolvedProject, { recursive: true, force: true });
  }
});

void test('refuses a concurrent installation without deleting the active lock', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'driver-install-lock-'));
  let admit: () => void = () => undefined;
  let release: () => void = () => undefined;
  const admitted = new Promise<void>((resolve) => {
    admit = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const blockingInstaller: PackageManagerInstaller = async ({ directory }) => {
    admit();
    await released;
    await materializeSdk(directory);
    return succeeded;
  };
  try {
    const first = installDriverRuntime({ projectDirectory, packageManager: blockingInstaller });
    await admitted;
    const contender = await installDriverRuntime({
      projectDirectory,
      packageManager: successfulInstaller,
    });
    assert.equal(contender.kind, 'driver-runtime-installation-failed');
    assert.equal(contender.failure.kind, 'driver-installation-in-progress');
    const lock = join(projectDirectory, '.blackbox', 'drivers', '.install.lock');
    assert.equal((await stat(lock)).isDirectory(), true);
    release();
    assert.equal((await first).kind, 'driver-runtime-installation-succeeded');
    await assert.rejects(stat(lock), /ENOENT/u);
  } finally {
    release();
    await rm(projectDirectory, { recursive: true, force: true });
  }
});
