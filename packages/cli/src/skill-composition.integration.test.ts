import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { blackboxSkill, skillModule } from '@suites/blackbox-cli/skills/blackbox';

const execFileAsync = promisify(execFile);
const packageDirectory = fileURLToPath(skillModule.packageRoot);

void test('composes selected package skills through the real CLI lifecycle', async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    [join(packageDirectory, 'bin/run.js'), 'skills', 'list', '--json'],
    { cwd: packageDirectory, encoding: 'utf8' },
  );

  assert.deepEqual(JSON.parse(stdout), {
    kind: 'skill-list',
    skills: [
      { name: 'capsule', dependencies: [], integrations: [] },
      { name: 'catalog', dependencies: [], integrations: [] },
      {
        name: 'blackbox',
        dependencies: [],
        integrations: [
          { name: 'discovery', available: true },
          { name: 'catalog', available: true },
          { name: 'capsule', available: true },
        ],
      },
      {
        name: 'discovery',
        dependencies: [],
        integrations: [
          { name: 'catalog', available: true },
          { name: 'capsule', available: true },
        ],
      },
    ],
  });
});

void test('copies the CLI-owned Blackbox skill for all hosts without copying optional skills', async (t) => {
  const project = await realpath(await mkdtemp(join(tmpdir(), 'blackbox-entry-skill-')));
  t.after(async () => rm(project, { recursive: true, force: true }));
  const manifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'));
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      join(packageDirectory, 'bin/run.js'),
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
  assert.deepEqual(result.source, { package: '@suites/blackbox-cli', version: manifest.version });
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
    assert.equal(record.sourcePackage, '@suites/blackbox-cli');
    assert.equal(record.version, manifest.version);
    const expectedFiles = ['SKILL.md', 'references/skill-installation.md'];
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
