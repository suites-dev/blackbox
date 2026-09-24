import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { nodeInstrumentationDependencies } from '@suites/blackbox-inst-runtime-node';
import { instrumentationDirectoryRelativePath } from '@suites/blackbox-instrumentation-internal';

import { runCli } from '../capsule/reporting/capsule-command.fixture.js';

async function seedDependencies(directory: string): Promise<void> {
  for (const [name, version] of Object.entries(nodeInstrumentationDependencies)) {
    const packageFile = join(directory, 'node_modules', ...name.split('/'), 'package.json');
    await mkdir(dirname(packageFile), { recursive: true });
    await writeFile(packageFile, `${JSON.stringify({ name, version })}\n`);
    await writeFile(join(dirname(packageFile), 'index.js'), 'module.exports = {};\n');
  }
}

void test('inst install creates the Node bootstrap and repeat installation leaves files unchanged', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'blackbox-cli-inst-'));
  try {
    const target = join(projectDirectory, instrumentationDirectoryRelativePath);
    await seedDependencies(target);
    const first = await runCli({
      directory: projectDirectory,
      argv: ['inst', 'install', '--runtime', 'node'],
    });
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /Node instrumentation installed/u);
    const packageFile = join(target, 'package.json');
    const sourceFile = join(target, 'instrumentation.js');
    const before = await Promise.all([stat(packageFile), stat(sourceFile)]);

    const second = await runCli({
      directory: projectDirectory,
      argv: ['inst', 'install', '--runtime', 'node'],
    });
    const after = await Promise.all([stat(packageFile), stat(sourceFile)]);
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /already current/u);
    assert.deepEqual(
      after.map((entry) => entry.mtimeMs),
      before.map((entry) => entry.mtimeMs),
    );
    assert.equal(JSON.parse(await readFile(packageFile, 'utf8')).private, true);
  } finally {
    await rm(projectDirectory, { recursive: true, force: true });
  }
});

void test('inst install rejects unsupported and conflicting installations', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'blackbox-cli-inst-failure-'));
  try {
    const unsupported = await runCli({
      directory: projectDirectory,
      argv: ['inst', 'install', '--runtime', 'python'],
    });
    assert.equal(unsupported.status, 1);
    assert.match(unsupported.stderr, /Unsupported instrumentation runtime: python/u);

    const target = join(projectDirectory, instrumentationDirectoryRelativePath);
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'instrumentation.js'), '// user owned\n');
    const conflict = await runCli({
      directory: projectDirectory,
      argv: ['inst', 'install', '--runtime', 'node'],
    });
    assert.equal(conflict.status, 1);
    assert.match(conflict.stderr, /Refusing to overwrite/u);
    assert.equal(await readFile(join(target, 'instrumentation.js'), 'utf8'), '// user owned\n');
  } finally {
    await rm(projectDirectory, { recursive: true, force: true });
  }
});
