import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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
  await writeFile(join(root, 'package.json'), '{"name":"fixture","version":"1.0.0"}\n');
  await writeFile(join(source, 'SKILL.md'), '---\nname: fixture\ndescription: Fixture\n---\n');
  const registry = createSkillRegistry([
    {
      apiVersion: 1,
      packageName: 'fixture',
      packageRoot: pathToFileURL(`${root}/`),
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
      expect(result.ok).toBe(true);
      expect(result.installations.map(({ skill }) => skill)).toEqual(['dependency', 'root']);
      expect(result.destinations.map(({ outcome }) => outcome)).toEqual(['installed', 'installed']);
      expect(
        await readFile(join(f.project, '.agents/skills/dependency/SKILL.md'), 'utf8'),
      ).toContain('name: fixture');
      await expect(access(join(f.project, '.agents/skills/optional'))).rejects.toThrow();
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it('stops the dependency chain when a required skill conflicts', async () => {
    const f = await fixture();
    try {
      const conflicts = [
        join(f.project, '.agents/skills/dependency'),
        join(f.project, '.claude/skills/dependency'),
      ];
      for (const conflict of conflicts) {
        await mkdir(conflict, { recursive: true });
        await writeFile(join(conflict, 'SKILL.md'), 'user-owned');
      }
      const result = await installSkill(
        { projectDirectory: f.project, skillName: 'root', agents: ['codex', 'claude'] },
        f.registry,
      );
      expect(result.ok).toBe(false);
      expect(result.installations).toHaveLength(1);
      expect(result.installations[0].skill).toBe('dependency');
      expect(result.destinations.map(({ outcome }) => outcome)).toEqual(['conflict', 'conflict']);
      await expect(access(join(f.project, '.agents/skills/root'))).rejects.toThrow();
      await expect(access(join(f.project, '.claude/skills/root'))).rejects.toThrow();
      for (const conflict of conflicts) {
        expect(await readFile(join(conflict, 'SKILL.md'), 'utf8')).toBe('user-owned');
      }
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });
});

describe('skill path safety', () => {
  it('rejects source links and linked destination parents without modifying their targets', async () => {
    const f = await fixture();
    try {
      await symlink(f.project, join(f.source, 'escape'));
      await expect(
        installSkill(
          { projectDirectory: f.project, skillName: 'root', agents: ['codex'] },
          f.registry,
        ),
      ).rejects.toThrow('symlinked skill path');
      await rm(join(f.source, 'escape'));
      await symlink(f.source, join(f.project, '.agents'));
      const result = await installSkill(
        { projectDirectory: f.project, skillName: 'root', agents: ['codex'] },
        f.registry,
      );
      expect(result.ok).toBe(false);
      expect(result.destinations[0]).toMatchObject({
        outcome: 'failed',
        reason: 'unsafe-path',
      });
      await expect(access(join(f.source, 'skills'))).rejects.toThrow();
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it('rejects a skill whose source is lexically outside its owning package', async () => {
    const f = await fixture();
    try {
      const outside = await mkdtemp(join(tmpdir(), 'blackbox-skill-outside-'));
      try {
        await writeFile(
          join(outside, 'SKILL.md'),
          '---\nname: outside\ndescription: Outside\n---\n',
        );
        const registry = createSkillRegistry([
          {
            apiVersion: 1,
            packageName: 'fixture',
            packageRoot: pathToFileURL(`${f.root}/`),
            skills: [
              {
                name: 'outside',
                source: pathToFileURL(outside),
                dependencies: [],
                integrations: [],
              },
            ],
          },
        ]);
        await expect(
          installSkill(
            { projectDirectory: f.project, skillName: 'outside', agents: ['codex'] },
            registry,
          ),
        ).rejects.toThrow('Skill source is outside its package: outside');
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });
});

describe('skill package ownership', () => {
  it('rejects a skill that escapes its owning package through a symlinked ancestor', async () => {
    const f = await fixture();
    try {
      const outside = await mkdtemp(join(tmpdir(), 'blackbox-skill-ancestor-'));
      try {
        await mkdir(join(outside, 'escaped'));
        await writeFile(
          join(outside, 'escaped/SKILL.md'),
          '---\nname: escaped\ndescription: Escaped\n---\n',
        );
        await symlink(outside, join(f.root, 'assets'));
        const registry = createSkillRegistry([
          {
            apiVersion: 1,
            packageName: 'fixture',
            packageRoot: pathToFileURL(`${f.root}/`),
            skills: [
              {
                name: 'escaped',
                source: pathToFileURL(join(f.root, 'assets/escaped')),
                dependencies: [],
                integrations: [],
              },
            ],
          },
        ]);
        await expect(
          installSkill(
            { projectDirectory: f.project, skillName: 'escaped', agents: ['codex'] },
            registry,
          ),
        ).rejects.toThrow('Skill source is outside its package: escaped');
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it('rejects a skill whose package manifest names a different owner', async () => {
    const f = await fixture();
    try {
      await writeFile(join(f.root, 'package.json'), '{"name":"impostor","version":"1.0.0"}\n');
      await expect(
        installSkill(
          { projectDirectory: f.project, skillName: 'root', agents: ['codex'] },
          f.registry,
        ),
      ).rejects.toThrow('Skill package manifest does not match fixture');
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });
});
