import { mkdir, mkdtemp, readFile, rm, symlink, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createSkillRegistry } from '../registry/registry.js';
import { installSkill } from './install.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'blackbox-skill-composition-'));
  const source = join(root, 'source');
  const project = join(root, 'project');
  await mkdir(source);
  await mkdir(project);
  await writeFile(join(source, 'SKILL.md'), '---\nname: fixture\ndescription: Fixture\n---\n');
  const registry = createSkillRegistry([
    {
      apiVersion: 1,
      packageName: 'fixture',
      skills: [
        {
          name: 'root',
          source: pathToFileURL(source),
          dependencies: ['dependency'],
          integrations: ['optional'],
        },
        { name: 'dependency', source: pathToFileURL(source), dependencies: [], integrations: [] },
        { name: 'optional', source: pathToFileURL(source), dependencies: [], integrations: [] },
      ],
    },
  ]);
  return { root, source, project, registry };
}

describe('composed installation', () => {
  it('copies required siblings for each agent without installing optional integrations', async () => {
    const f = await fixture();
    try {
      const result = await installSkill(
        { projectDirectory: f.project, skillName: 'root', agents: ['codex', 'cursor'] },
        f.registry,
      );
      expect(result.map(({ kind }) => kind)).toEqual([
        'installed',
        'installed',
        'installed',
        'installed',
      ]);
      for (const agent of ['.agents', '.cursor']) {
        expect(
          await readFile(join(f.project, agent, 'skills/dependency/SKILL.md'), 'utf8'),
        ).toContain('name: fixture');
        await expect(access(join(f.project, agent, 'skills/optional'))).rejects.toThrow();
      }
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it('preflights every dependency and agent conflict before publishing any new skill', async () => {
    const f = await fixture();
    try {
      const conflict = join(f.project, '.claude/skills/root');
      await mkdir(conflict, { recursive: true });
      await writeFile(join(conflict, 'SKILL.md'), 'user-owned');
      const result = await installSkill(
        { projectDirectory: f.project, skillName: 'root', agents: ['codex', 'claude'] },
        f.registry,
      );
      expect(result).toEqual([{ kind: 'conflict', agent: 'claude', path: conflict }]);
      await expect(access(join(f.project, '.agents'))).rejects.toThrow();
      await expect(access(join(f.project, '.claude/skills/dependency'))).rejects.toThrow();
      expect(await readFile(join(conflict, 'SKILL.md'), 'utf8')).toBe('user-owned');
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it('rejects source links and linked destination parents without modifying their targets', async () => {
    const f = await fixture();
    try {
      await symlink(f.project, join(f.source, 'escape'));
      await expect(
        installSkill(
          { projectDirectory: f.project, skillName: 'root', agents: ['codex'] },
          f.registry,
        ),
      ).rejects.toThrow('Unsupported skill asset');
      await rm(join(f.source, 'escape'));
      await symlink(f.source, join(f.project, '.agents'));
      await expect(
        installSkill(
          { projectDirectory: f.project, skillName: 'root', agents: ['codex'] },
          f.registry,
        ),
      ).rejects.toThrow('symbolic link');
      await expect(access(join(f.source, 'skills'))).rejects.toThrow();
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });
});
