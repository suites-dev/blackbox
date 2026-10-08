import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
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
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test, type TestContext } from 'vitest';
import { blackboxSkill, skillModule } from './skills.js';

const execFileAsync = promisify(execFile);
const packageDirectory = fileURLToPath(skillModule.packageRoot);
const cliDirectory = fileURLToPath(new URL('../', import.meta.resolve('@suites/blackbox-cli/run')));

async function consumer({ onTestFinished }: TestContext): Promise<string> {
  const project = await realpath(await mkdtemp(join(tmpdir(), 'blackbox-main-consumer-')));
  onTestFinished(async () => rm(project, { recursive: true, force: true }));
  await writeFile(
    join(project, 'package.json'),
    JSON.stringify({
      name: 'main-consumer',
      dependencies: {
        '@suites/blackbox': '0.0.1-alpha.0',
        '@suites/blackbox-cli': '0.0.1-alpha.0',
      },
    }),
  );
  const main = join(project, 'node_modules/@suites/blackbox');
  await mkdir(main, { recursive: true });
  for (const file of ['package.json', 'dist', 'skills']) {
    await cp(join(packageDirectory, file), join(main, file), { recursive: true });
  }
  // Select only this consumer's modules, never the source checkout's adapters.
  await symlink(join(packageDirectory, 'node_modules'), join(main, 'node_modules'), 'dir');
  const cli = join(project, 'node_modules/@suites/blackbox-cli');
  await mkdir(cli);
  for (const file of ['package.json', 'bin', 'dist']) {
    await cp(join(cliDirectory, file), join(cli, file), { recursive: true });
  }
  await symlink(join(cliDirectory, 'node_modules'), join(cli, 'node_modules'), 'dir');
  return join(cli, 'bin/run.js');
}

test('composes default package skills through the separately installed CLI', async (context) => {
  const manifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'));
  assert.equal(manifest.bin, undefined, 'the main package must not publish an executable');
  const executable = await consumer(context);
  const { stdout } = await execFileAsync(
    process.execPath,
    [executable, 'skills', 'list', '--json'],
    { cwd: tmpdir(), encoding: 'utf8' },
  );

  assert.deepEqual(JSON.parse(stdout), {
    kind: 'skill-list',
    skills: [
      {
        name: 'blackbox',
        dependencies: [],
        integrations: [
          { name: 'discovery', available: true },
          { name: 'catalog', available: true },
          { name: 'capsule', available: false },
        ],
      },
      { name: 'catalog', dependencies: [], integrations: [] },
      {
        name: 'discovery',
        dependencies: [],
        integrations: [
          { name: 'catalog', available: true },
          { name: 'capsule', available: false },
        ],
      },
    ],
  });
});

test('copies the main package skill for all hosts without copying other skills', async (context) => {
  const executable = await consumer(context);
  const project = await realpath(await mkdtemp(join(tmpdir(), 'blackbox-entry-skill-')));
  context.onTestFinished(async () => rm(project, { recursive: true, force: true }));
  const manifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'));
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      executable,
      'skills',
      'install',
      'blackbox',
      '--codex',
      '--cursor',
      '--claude',
      '--gitignore',
      '--json',
    ],
    { cwd: project, encoding: 'utf8' },
  );
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true);
  assert.deepEqual(result.source, { package: '@suites/blackbox', version: manifest.version });
  assert.deepEqual(result.results, [
    { agent: 'codex', kind: 'installed', path: join(project, '.agents/skills/blackbox') },
    { agent: 'cursor', kind: 'installed', path: join(project, '.agents/skills/blackbox') },
    { agent: 'claude', kind: 'installed', path: join(project, '.claude/skills/blackbox') },
  ]);
  for (const host of ['.agents', '.claude']) {
    assert.deepEqual(await readdir(join(project, host, 'skills')), ['blackbox']);
    const destination = join(project, host, 'skills/blackbox');
    const record = JSON.parse(
      await readFile(join(destination, '.blackbox-install.json'), 'utf8'),
    ) as {
      readonly sourcePackage: string;
      readonly version: string;
      readonly files: Readonly<Record<string, string>>;
    };
    assert.equal(record.sourcePackage, '@suites/blackbox');
    assert.equal(record.version, manifest.version);
    const expectedFiles = [
      'SKILL.md',
      'references/onboarding.md',
      'references/skill-installation.md',
    ];
    assert.deepEqual(Object.keys(record.files).sort(), expectedFiles);
    for (const file of expectedFiles) {
      const expected = await readFile(new URL(file, blackboxSkill.source));
      assert.deepEqual(await readFile(join(destination, file)), expected);
      assert.equal(
        record.files[file],
        `sha256:${createHash('sha256').update(expected).digest('hex')}`,
      );
    }
  }
  const ignored = await readFile(join(project, '.gitignore'), 'utf8');
  assert.match(ignored, /^\/\.agents\/skills\/blackbox\/$/mu);
  assert.match(ignored, /^\/\.claude\/skills\/blackbox\/$/mu);
});
