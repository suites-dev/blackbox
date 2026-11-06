import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import { verifyConsumerComposition } from './composition.mjs';

async function fixture(
  t,
  {
    extra = [],
    omit = [],
    executableOwner = 'blackbox-cli',
    runnerVersion = '1.64.1',
    installedRunnerVersion = '1.64.1',
  } = {},
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'blackbox-consumer-composition-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dependencies = Object.fromEntries(
    [
      '@suites/blackbox',
      '@suites/blackbox-capsule',
      '@suites/blackbox-cli',
      '@suites/blackbox-driver',
      '@suites/blackbox-effects',
      '@suites/blackbox-feature',
      '@suites/blackbox-inst-runtime-node',
      '@suites/blackbox-playwright',
      ...extra,
    ]
      .filter((name) => !omit.includes(name))
      .map((name) => [name, '0.0.1-alpha.0']),
  );
  if (!omit.includes('@playwright/test')) dependencies['@playwright/test'] = runnerVersion;
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
  const runner = join(root, 'node_modules', '@playwright', 'test');
  await mkdir(runner, { recursive: true });
  await writeFile(
    join(runner, 'package.json'),
    JSON.stringify({
      name: '@playwright/test',
      version: installedRunnerVersion,
    }),
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
      '@suites/blackbox-effects',
      '@suites/blackbox-feature',
      '@suites/blackbox-inst-runtime-node',
      '@suites/blackbox-playwright',
    ],
    runner: {
      name: '@playwright/test',
      version: '1.64.1',
      packageRoot: join(root, 'node_modules', '@playwright', 'test'),
    },
    cliEntrypoint: join(root, 'node_modules', '@suites', 'blackbox-cli', 'bin', 'run.js'),
  });
});

test('requires an explicit exact Playwright pin rather than a floating automatic peer', async (t) => {
  for (const options of [
    { omit: ['@playwright/test'] },
    { runnerVersion: '^1.64.1' },
    { runnerVersion: '1.65.0' },
  ]) {
    await assert.rejects(verifyConsumerComposition(await fixture(t, options)), /must pin/u);
  }
});

test('rejects installed runner bytes whose package version differs from the consumer pin', async (t) => {
  const root = await fixture(t, { installedRunnerVersion: '1.65.0' });
  await assert.rejects(verifyConsumerComposition(root), /does not match the exact consumer pin/u);
});

test('accepts an independently installed runner through a symlinked consumer ancestor', async (t) => {
  const root = await fixture(t);
  const aliases = await mkdtemp(join(tmpdir(), 'blackbox-consumer-alias-'));
  t.after(() => rm(aliases, { recursive: true, force: true }));
  await symlink(dirname(root), join(aliases, 'ancestor'));
  const aliasedRoot = join(aliases, 'ancestor', basename(root));
  assert.deepEqual(await verifyConsumerComposition(aliasedRoot), await verifyConsumerComposition(root));
});

test('canonicalizing the consumer does not admit a runner installed outside its boundary', async (t) => {
  const root = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), 'blackbox-runner-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'package.json'), JSON.stringify({ name: '@playwright/test', version: '1.64.1' }));
  const runner = join(root, 'node_modules', '@playwright', 'test');
  await rm(runner, { recursive: true });
  await symlink(outside, runner);
  await assert.rejects(verifyConsumerComposition(root), /escaped the independent consumer/u);
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
