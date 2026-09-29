import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { installSkill } from './install.js';

const ASSETS = fileURLToPath(new URL('../../assets/discovery', import.meta.url));

async function files(directory: string): Promise<string[]> {
  return (await readdir(directory, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(directory.length + 1))
    .sort();
}

async function withProject(run: (projectDirectory: string) => Promise<void>): Promise<void> {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'blackbox-skills-'));
  try {
    await run(projectDirectory);
  } finally {
    await rm(projectDirectory, { recursive: true, force: true });
  }
}

describe('skill installation', () => {
  it('installs the complete packaged tree for each agent and is idempotent', async () => {
    await withProject(async (projectDirectory) => {
      const version = (
        JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as {
          version: string;
        }
      ).version;
      const first = await installSkill({
        projectDirectory,
        skillName: 'discovery',
        agents: ['codex', 'claude', 'cursor'],
      });
      expect(first.ok).toBe(true);
      expect(first.version).toBe(version);
      expect(
        first.destinations.map(({ path, agents, outcome }) => ({ path, agents, outcome })),
      ).toEqual([
        { path: '.agents/skills/discovery', agents: ['codex', 'cursor'], outcome: 'installed' },
        { path: '.claude/skills/discovery', agents: ['claude'], outcome: 'installed' },
      ]);
      const source = await files(ASSETS);
      expect(source).toContain('SKILL.md');
      for (const { path } of first.destinations) {
        const installed = join(projectDirectory, path);
        expect(await files(installed)).toEqual([...source, '.blackbox-install.json'].sort());
        for (const file of source) {
          expect(await readFile(join(installed, file))).toEqual(await readFile(join(ASSETS, file)));
        }
      }
      const second = await installSkill({
        projectDirectory,
        skillName: 'discovery',
        agents: ['codex'],
      });
      expect(second.destinations.map(({ outcome }) => outcome)).toEqual(['unchanged']);
    });
  });

  it('refuses to overwrite a conflicting target', async () => {
    await withProject(async (projectDirectory) => {
      const target = join(projectDirectory, '.agents/skills/discovery/SKILL.md');
      await mkdir(join(projectDirectory, '.agents/skills/discovery'), { recursive: true });
      await writeFile(target, 'user-owned\n');
      const result = await installSkill({
        projectDirectory,
        skillName: 'discovery',
        agents: ['codex'],
      });
      expect(result.ok).toBe(false);
      expect(result.destinations[0]).toMatchObject({
        outcome: 'conflict',
        reason: 'not-installed-by-blackbox',
      });
      expect(await readFile(target, 'utf8')).toBe('user-owned\n');
      expect(await files(join(projectDirectory, '.agents/skills/discovery'))).toEqual(['SKILL.md']);
    });
  });

  it('adopts a manual copy of the same version by adding only the record', async () => {
    await withProject(async (projectDirectory) => {
      const target = join(projectDirectory, '.claude/skills/discovery');
      await mkdir(join(projectDirectory, '.claude/skills'), { recursive: true });
      await cp(ASSETS, target, { recursive: true });
      const before = await files(target);
      const result = await installSkill({
        projectDirectory,
        skillName: 'discovery',
        agents: ['claude'],
      });
      expect(result.destinations[0].outcome).toBe('adopted');
      expect(await files(target)).toEqual([...before, '.blackbox-install.json'].sort());
      const repeat = await installSkill({
        projectDirectory,
        skillName: 'discovery',
        agents: ['claude'],
      });
      expect(repeat.destinations[0].outcome).toBe('unchanged');
    });
  });
});
