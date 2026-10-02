import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { verifyConsumerComposition } from './composition.mjs';

async function fixture(t, { extra = [], omit = [], executableOwner = 'blackbox-cli' } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'blackbox-consumer-composition-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dependencies = Object.fromEntries(
    [
      '@suites/blackbox',
      '@suites/blackbox-capsule',
      '@suites/blackbox-cli',
      '@suites/blackbox-driver',
      '@suites/blackbox-inst-runtime-node',
      '@suites/blackbox-playwright',
      ...extra,
    ]
      .filter((name) => !omit.includes(name))
      .map((name) => [name, '0.0.1-alpha.0']),
  );
  await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies }));
  for (const name of ['blackbox', 'blackbox-cli']) {
    const bin = join(root, 'node_modules', '@suites', name, 'bin');
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, 'run.js'), '');
  }
  await mkdir(join(root, 'node_modules', '.bin'));
  await symlink(
    `../@suites/${executableOwner}/bin/run.js`,
    join(root, 'node_modules', '.bin', 'blackbox'),
  );
  return root;
}

test('accepts the default package plus explicit CLI and adapters with the CLI executable', async (t) => {
  const root = await fixture(t);
  assert.deepEqual(await verifyConsumerComposition(root), {
    directPackages: [
      '@suites/blackbox',
      '@suites/blackbox-capsule',
      '@suites/blackbox-cli',
      '@suites/blackbox-driver',
      '@suites/blackbox-inst-runtime-node',
      '@suites/blackbox-playwright',
    ],
    cliEntrypoint: join(root, 'node_modules', '@suites', 'blackbox-cli', 'bin', 'run.js'),
  });
});

test('rejects a consumer that hides missing transitive dependencies with direct installs', async (t) => {
  const root = await fixture(t, { extra: ['@suites/blackbox-skills'] });
  await assert.rejects(verifyConsumerComposition(root), /not internal packages/u);
});

test('rejects a consumer running an executable from the main package instead of the CLI', async (t) => {
  const root = await fixture(t, { executableOwner: 'blackbox' });
  await assert.rejects(
    verifyConsumerComposition(root),
    /does not belong to @suites\/blackbox-cli/u,
  );
});

test('requires an explicit CLI dependency even when its executable exists transitively', async (t) => {
  const root = await fixture(t, { omit: ['@suites/blackbox-cli'] });
  await assert.rejects(verifyConsumerComposition(root), /main package, CLI, and adapters/u);
});
