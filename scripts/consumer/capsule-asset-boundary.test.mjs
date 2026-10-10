import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { packedPackages } from './capsule-asset-boundary.mjs';

test('fixed packed-consumer inventory includes every publishable workspace package', async () => {
  const packagesRoot = fileURLToPath(new URL('../../packages/', import.meta.url));
  const manifests = await Promise.all(
    (await readdir(packagesRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => JSON.parse(
        await readFile(join(packagesRoot, entry.name, 'package.json'), 'utf8'),
      )),
  );
  const published = manifests.filter((manifest) => manifest.private !== true)
    .map((manifest) => manifest.name).sort();
  assert.ok(published.includes('@suites/blackbox-effects'));
  assert.deepEqual([...packedPackages].sort(), published);
});
