import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CAPSULE_A } from './project.fixture.js';
import { onlyDocument, run } from './run-cli.fixture.js';

void test('ls, use and systems failures outside a project are single documents', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bb-no-project-'));
  try {
    for (const argv of [
      ['capsule', 'ls', '--json'],
      ['capsule', 'use', CAPSULE_A, '--json'],
    ]) {
      const result = await run(directory, ...argv);
      assert.equal(result.status, 125, argv.join(' '));
      assert.equal(onlyDocument(result).code, 'operation-failed');
    }
    const systems = await run(directory, 'catalog', 'ls', '--json');
    assert.equal(systems.status, 125);
    assert.equal(onlyDocument(systems).kind, 'catalog-command-user-error');
    const up = await run(directory, 'capsule', 'up', '--json');
    assert.equal(up.status, 125);
    assert.equal(onlyDocument(up).kind, 'catalog-command-user-error');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
