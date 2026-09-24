import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli } from '../capsule/reporting/capsule-command.fixture.js';

void test('client install is idempotent and preserves user-owned dependencies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-client-install-'));
  try {
    const first = await runCli({
      directory,
      argv: ['client', 'install', '--runtime', 'node', '--json'],
    });
    assert.equal(first.status, 0, first.stderr);
    assert.deepEqual(JSON.parse(first.stdout).files, {
      package: 'created',
      runtime: 'created',
    });
    const packagePath = join(directory, '.blackbox', 'clients', 'package.json');
    const authored = '{"private":true,"dependencies":{"pg":"8.16.3"}}\n';
    await writeFile(packagePath, authored);
    const repeated = await runCli({
      directory,
      argv: ['client', 'install', '--runtime', 'node', '--json'],
    });
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.deepEqual(JSON.parse(repeated.stdout).files, {
      package: 'retained',
      runtime: 'retained',
    });
    assert.equal(await readFile(packagePath, 'utf8'), authored);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test('client install rejects unsupported runtimes without creating files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-client-runtime-'));
  try {
    const result = await runCli({
      directory,
      argv: ['client', 'install', '--runtime', 'python'],
    });
    assert.equal(result.status, 2);
  assert.match(result.stderr, /Expected --runtime=python to be one of: node/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
