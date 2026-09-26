import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { installDriverRuntime } from './install-driver-runtime.js';

const succeeded = { kind: 'package-manager-install-succeeded', packageManager: 'npm',
  exitCode: 0, stderr: '' } as const;

async function materializeSdk(directory: string): Promise<string> {
  const target = join(directory, 'node_modules', '@suites', 'blackbox-driver');
  await mkdir(target, { recursive: true });
  await writeFile(join(target, 'package.json'), JSON.stringify({
    name: '@suites/blackbox-driver', type: 'module', exports: './index.js',
  }));
  const entrypoint = join(target, 'index.js');
  await writeFile(entrypoint, 'export {};\n');
  return realpath(entrypoint);
}

for (const spec of ['^1.2.3', 'file:../../vendor/blackbox-driver.tgz']) {
  void test(`preserves the exact authored SDK spec ${spec} and manifest bytes`, async () => {
    const projectDirectory = await mkdtemp(join(tmpdir(), 'driver-authored-spec-'));
    try {
      const directory = join(projectDirectory, '.blackbox', 'drivers');
      await mkdir(directory, { recursive: true });
      const source = `${JSON.stringify({ name: 'user-drivers', private: true,
        scripts: { inspect: 'node inspect.js' }, overrides: { pg: '8.16.3' },
        dependencies: { '@suites/blackbox-driver': spec, pg: '8.16.3' },
      }, null, '\t')}\n`;
      await writeFile(join(directory, 'package.json'), source);
      const result = await installDriverRuntime({ projectDirectory,
        packageManager: async (input) => { await materializeSdk(input.directory); return succeeded; },
      });
      if (!result.ok) {
        assert.fail(result.message);
      }
      assert.equal(result.files.package, 'retained');
      assert.equal(result.dependency.spec, spec);
      assert.equal(await readFile(join(directory, 'package.json'), 'utf8'), source);
    } finally {
      await rm(projectDirectory, { recursive: true, force: true });
    }
  });
}

for (const source of ['{not-json', '{"schemaVersion":999,"runtime":"node"}\n']) {
  void test(`rejects and retains a corrupt runtime artifact: ${source}`, async () => {
    const projectDirectory = await mkdtemp(join(tmpdir(), 'driver-corrupt-runtime-'));
    try {
      const directory = join(projectDirectory, '.blackbox', 'drivers');
      await mkdir(directory, { recursive: true });
      const manifest = '{"private":true,"dependencies":{"@suites/blackbox-driver":"^1.2.3"}}\n';
      await writeFile(join(directory, 'package.json'), manifest);
      const artifactPath = join(directory, 'blackbox-driver-runtime.json');
      await writeFile(artifactPath, source);
      let installs = 0;
      const result = await installDriverRuntime({ projectDirectory,
        packageManager: () => { installs += 1; return Promise.resolve(succeeded); },
      });
      assert.equal(result.kind, 'driver-runtime-installation-failed');
      assert.equal(result.failure.kind, 'driver-runtime-artifact-invalid');
      assert.equal(installs, 0);
      assert.equal(await readFile(artifactPath, 'utf8'), source);
      assert.equal(await readFile(join(directory, 'package.json'), 'utf8'), manifest);
      await assert.rejects(stat(join(directory, '.install.lock')), { code: 'ENOENT' });
    } finally {
      await rm(projectDirectory, { recursive: true, force: true });
    }
  });
}

void test('cannot verify installation using a resolvable parent workspace SDK without a local SDK', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'driver-parent-workspace-'));
  try {
    const parentEntrypoint = await materializeSdk(workspace);
    const projectDirectory = join(workspace, 'consumer');
    const directory = join(projectDirectory, '.blackbox', 'drivers');
    await mkdir(directory, { recursive: true });
    const require = createRequire(join(directory, 'package.json'));
    assert.equal(require.resolve('@suites/blackbox-driver'), parentEntrypoint);
    const result = await installDriverRuntime({ projectDirectory,
      packageManager: () => Promise.resolve(succeeded),
    });
    assert.equal(result.kind, 'driver-runtime-installation-failed');
    assert.equal(result.failure.kind, 'driver-sdk-unresolved');
    await assert.rejects(stat(join(directory, 'node_modules')), { code: 'ENOENT' });
    assert.equal(require.resolve('@suites/blackbox-driver'), parentEntrypoint);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
