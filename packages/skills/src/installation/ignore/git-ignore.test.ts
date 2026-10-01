import { link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { ignoreInstalledSkills } from './git-ignore.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function project(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'blackbox-ignore-'));
  directories.push(path);
  return path;
}

it('creates precise anchored entries and rejects traversal before creating .gitignore', async () => {
  const directory = await project();
  expect(await ignoreInstalledSkills(directory, ['../outside'])).toMatchObject({
    outcome: 'failed',
  });
  await expect(readFile(join(directory, '.gitignore'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await ignoreInstalledSkills(directory, ['.claude/skills/fixture'])).toMatchObject({
    outcome: 'updated',
  });
  expect(await readFile(join(directory, '.gitignore'), 'utf8')).toBe(
    '\n# Blackbox installed skills\n/.claude/skills/fixture/\n',
  );
});

it('rejects hardlinks and directories without changing the target', async () => {
  const directory = await project();
  const target = join(directory, 'existing');
  await writeFile(target, 'user rules\n');
  await link(target, join(directory, '.gitignore'));
  expect(await ignoreInstalledSkills(directory, ['.agents/skills/fixture'])).toMatchObject({
    outcome: 'failed',
  });
  expect(await readFile(target, 'utf8')).toBe('user rules\n');
  const other = await project();
  await mkdir(join(other, '.gitignore'));
  expect(await ignoreInstalledSkills(other, ['.agents/skills/fixture'])).toMatchObject({
    outcome: 'failed',
  });
});
