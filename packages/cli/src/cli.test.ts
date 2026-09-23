import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { runCli } from './capsule-command.fixture.js';

void test('oclif discovers the facade and help names the phases', async () => {
  const result = await runCli({ directory: process.cwd(), argv: ['--help'] });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Sandboxes, Testing, and Assurance/u);
  assert.match(result.stdout, /capsule/u);
  assert.match(result.stdout, /catalog/u);
});

void test('catalog list delegates to the catalog package and emits deterministic JSON', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const result = spawnSync(process.execPath, [join(here, '..', 'bin', 'run.js'), 'catalog', 'list', '--json'], {
    cwd: join(here, '../../../e2e'), encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    default: 'subscription-system',
    entries: [
      { id: 'payment-mock', kind: 'subsystem', isDefault: false },
      { id: 'payment-mock-dist', kind: 'subsystem', isDefault: false },
      { id: 'subscription-system', kind: 'system', isDefault: true },
    ],
  });
});

void test('catalog validation reports a missing project file as a nonzero CLI error', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bb-missing-catalog-'));
  try {
    const result = await runCli({ directory, argv: ['catalog', 'validate'] });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /blackbox\.config\.yaml/u);
    assert.equal(result.stdout, '');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
