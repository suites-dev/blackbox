import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

import { installSkill } from './install.js';

describe('skill installation', () => {
  it('installs each selected agent target and is idempotent', async () => {
    const projectDirectory = await mkdtemp(join(tmpdir(), 'blackbox-skills-'));
    try {
      const first = await installSkill({
        projectDirectory,
        skillName: 'discovery',
        agents: ['codex', 'claude', 'cursor'],
      });
      expect(first.map((result) => result.kind)).toEqual(['installed', 'installed', 'installed']);
      expect(
        await readFile(join(projectDirectory, '.agents/skills/discovery/SKILL.md'), 'utf8'),
      ).toContain('name: discovery');
      const second = await installSkill({
        projectDirectory,
        skillName: 'discovery',
        agents: ['codex'],
      });
      expect(second).toEqual([
        {
          kind: 'unchanged',
          agent: 'codex',
          path: join(projectDirectory, '.agents/skills/discovery'),
        },
      ]);
    } finally {
      await rm(projectDirectory, { recursive: true, force: true });
    }
  });

  it('refuses to overwrite a conflicting target', async () => {
    const projectDirectory = await mkdtemp(join(tmpdir(), 'blackbox-skills-conflict-'));
    try {
      const target = join(projectDirectory, '.agents/skills/discovery/SKILL.md');
      await mkdir(join(projectDirectory, '.agents/skills/discovery'), { recursive: true });
      await writeFile(target, 'user-owned\n');
      const result = await installSkill({
        projectDirectory,
        skillName: 'discovery',
        agents: ['codex'],
      });
      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe('conflict');
      expect(await readFile(target, 'utf8')).toBe('user-owned\n');
    } finally {
      await rm(projectDirectory, { recursive: true, force: true });
    }
  });
});
