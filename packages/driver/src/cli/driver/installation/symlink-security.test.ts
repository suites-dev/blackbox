import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { installDriverRuntime } from './install-driver-runtime.js';

const packageManager = () => {
  assert.fail('package manager must not run for an unsafe installation path');
};

void test('rejects a symlinked driver installation directory', async () => {
  const project = await mkdtemp(join(tmpdir(), 'driver-symlink-project-'));
  const outside = await mkdtemp(join(tmpdir(), 'driver-symlink-outside-'));
  try {
    await mkdir(join(project, '.blackbox'));
    await symlink(outside, join(project, '.blackbox', 'drivers'));
    const result = await installDriverRuntime({ projectDirectory: project, packageManager });
    assert.equal(result.kind, 'driver-runtime-installation-failed');
    assert.match(result.message, /unsafe driver directory/u);
  } finally {
    await Promise.all([
      rm(project, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]);
  }
});

void test('rejects a symlinked managed driver manifest', async () => {
  const project = await mkdtemp(join(tmpdir(), 'driver-file-symlink-project-'));
  const outside = join(await mkdtemp(join(tmpdir(), 'driver-file-symlink-outside-')), 'owned.json');
  try {
    const drivers = join(project, '.blackbox', 'drivers');
    await mkdir(drivers, { recursive: true });
    await writeFile(outside, '{"owned":true}\n');
    await symlink(outside, join(drivers, 'package.json'));
    const result = await installDriverRuntime({ projectDirectory: project, packageManager });
    assert.equal(result.kind, 'driver-runtime-installation-failed');
    assert.match(result.message, /symlinked driver path/u);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(join(outside, '..'), { recursive: true, force: true });
  }
});
