import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const embedded = process.argv.includes('--embedded');
const authoredModules = [
  'domain.ts',
  'fixture-control-auth.ts',
  'lib/config.ts',
  'lib/database.ts',
  'lib/http.ts',
  'lib/log.ts',
  'lib/queue.ts',
  'lib/redis.ts',
  'lib/retry.ts',
  'public-api/app.ts',
  'public-api/database-repository.ts',
  'public-api/downstream-clients.ts',
  'public-api/fixture-control.ts',
  'public-api/redis-repository.ts',
  'public-api/routes.ts',
  'public-api/server.ts',
  'public-api/subscriptions.ts',
  'fraud-check/app.ts',
  'fraud-check/assessment.ts',
  'fraud-check/repository.ts',
  'fraud-check/routes.ts',
  'fraud-check/server.ts',
  'order-service/app.ts',
  'order-service/orders.ts',
  'order-service/queue-publisher.ts',
  'order-service/routes.ts',
  'order-service/server.ts',
  'payment-mock/app.ts',
  'payment-mock/routes.ts',
  'payment-mock/server.ts',
  'payment-mock/state.ts',
];
const expectedGenerated = authoredModules
  .map((relative) => relative.replace(/\.ts$/, '.js'))
  .sort();
assert.deepEqual(
  (await generatedModules(path.join(root, 'dist'))).sort(),
  expectedGenerated,
  'generated production module census',
);

for (const authoredRelative of authoredModules) {
  const generatedRelative = authoredRelative.replace(/\.ts$/, '.js');
  const generatedPath = path.join(root, 'dist', generatedRelative);
  const mapPath = `${generatedPath}.map`;
  const generated = await readFile(generatedPath, 'utf8');
  const parsed = JSON.parse(await readFile(mapPath, 'utf8'));

  assert.equal(parsed.version, 3, `${generatedRelative} map version`);
  assert.equal('sections' in parsed, false, `${generatedRelative} must use a regular map`);
  assert.equal(
    parsed.file,
    path.basename(generatedRelative),
    `${generatedRelative} generated file`,
  );
  assert.deepEqual(parsed.sources.length, 1, `${generatedRelative} source cardinality`);
  assert.deepEqual(
    parsed.sourcesContent.length,
    1,
    `${generatedRelative} sourcesContent cardinality`,
  );
  assert.equal(typeof parsed.sourcesContent[0], 'string', `${generatedRelative} sourcesContent`);
  assert.equal(
    parsed.sourcesContent[0].length > 0,
    true,
    `${generatedRelative} sourcesContent empty`,
  );
  assert.match(
    generated,
    new RegExp(`//# sourceMappingURL=${path.basename(generatedRelative)}\\.map\\s*$`),
    `${generatedRelative} sidecar link`,
  );
  assert.match(generated, /^"use strict";/, `${generatedRelative} CommonJS prologue`);

  const mappedAuthoredPath = path.resolve(path.dirname(mapPath), parsed.sources[0]);
  const expectedAuthoredPath = path.join(root, 'src', authoredRelative);
  assert.equal(mappedAuthoredPath, expectedAuthoredPath, `${generatedRelative} authored binding`);
  if (!embedded) {
    assert.equal(
      parsed.sourcesContent[0],
      await readFile(expectedAuthoredPath, 'utf8'),
      `${generatedRelative} exact sourcesContent`,
    );
  }
}

if (embedded) {
  assert.match(process.env.NODE_OPTIONS ?? '', /(?:^|\s)--enable-source-maps(?:\s|$)/);
  const config = await import(pathToFileURL(path.join(root, 'dist/lib/config.js')).href);
  let mappedStack = '';
  try {
    config.requiredEnvironment('SOURCE_MAP_PROBE_MUST_BE_UNSET');
  } catch (error) {
    mappedStack = error instanceof Error ? (error.stack ?? '') : '';
  }
  assert.match(mappedStack, /src\/lib\/config\.ts:\d+:\d+/, 'runtime stack uses authored source');
}

console.log(
  `PASS ${String(authoredModules.length)} Node CommonJS sidecar source maps${embedded ? ' embedded in image' : ''}`,
);

async function generatedModules(directory, prefix = '') {
  const modules = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      modules.push(...(await generatedModules(path.join(directory, entry.name), relative)));
    } else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) {
      modules.push(relative);
    }
  }
  return modules;
}
