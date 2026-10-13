import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

void test('CLI-only agent onboarding prints an actionable prompt without changing the project', async (t) => {
  const consumer = await mkdtemp(join(tmpdir(), 'blackbox-agent-onboarding-'));
  t.after(async () => rm(consumer, { recursive: true, force: true }));

  const testDirectory = fileURLToPath(new URL('.', import.meta.url));
  const sourceDist = await realpath(join(testDirectory, 'dist'));
  const sourcePackage = dirname(sourceDist);
  const manifest = JSON.parse(await readFile(join(sourcePackage, 'package.json'), 'utf8')) as {
    version: string;
  };
  const cli = join(consumer, 'node_modules', '@suites', 'blackbox-cli');
  const project = join(consumer, 'project');
  await mkdir(cli, { recursive: true });
  await mkdir(project);
  await cp(sourceDist, join(cli, 'dist'), { recursive: true });
  await cp(join(sourcePackage, 'bin'), join(cli, 'bin'), { recursive: true });
  await cp(join(sourcePackage, 'package.json'), join(cli, 'package.json'));
  await symlink(join(sourcePackage, 'node_modules'), join(cli, 'node_modules'), 'dir');
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({
      name: 'cli-only-consumer',
      dependencies: { '@suites/blackbox-cli': manifest.version },
    }),
  );
  await writeFile(join(project, 'keep.txt'), 'unchanged');

  const executable = join(cli, 'bin', 'run.js');
  const invoke = (...args: string[]) =>
    spawnSync(process.execPath, [executable, ...args], {
      cwd: project,
      encoding: 'utf8',
      timeout: 15_000,
    });

  const result = invoke('agent', 'onboarding', 'start');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const packages = result.stdout.match(/@suites\/blackbox(?:-[a-z]+)*/gu) ?? [];
  assert.deepEqual(packages.sort(), [
    '@suites/blackbox',
    '@suites/blackbox-cli',
    '@suites/blackbox-discovery',
    '@suites/blackbox-skills',
  ]);
  assert.match(result.stdout, /project's package manager and configured registry/u);
  assert.match(result.stdout, /blackbox skills install blackbox --codex/u);
  assert.match(result.stdout, /blackbox skills install discovery --codex/u);
  assert.match(result.stdout, /--claude or --cursor/u);
  assert.match(result.stdout, /Load and read the installed blackbox skill/u);
  assert.match(result.stdout, /references\/onboarding\.md/u);
  assert.deepEqual(await readdir(project), ['keep.txt']);
  assert.equal(await readFile(join(project, 'keep.txt'), 'utf8'), 'unchanged');

  const help = invoke('agent', 'onboarding', 'start', '--help');
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Print the prompt for an agent/u);

  for (const args of [
    ['agent', 'onboarding', 'start', '--unknown'],
    ['agent', 'onboarding', 'start', 'extra'],
  ]) {
    const invalid = invoke(...args);
    assert.notEqual(invalid.status, 0, `${args.join(' ')} accepted invalid input`);
  }
  assert.deepEqual(await readdir(project), ['keep.txt']);
});
