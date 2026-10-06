import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { canonicalNpmInstallLocation } from './npm-prefix.mjs';

test('uses one canonical path for npm cwd and --prefix across a filesystem alias', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blackbox-npm-prefix-'));
  try {
    const actual = join(root, 'actual', 'consumer');
    const alias = join(root, 'consumer-alias');
    await mkdir(actual, { recursive: true });
    await symlink(actual, alias, 'dir');

    const location = await canonicalNpmInstallLocation(alias);
    const canonical = await realpath(actual);
    assert.deepEqual(location, { cwd: canonical, prefix: canonical });
    assert.notEqual(location.prefix, alias);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
