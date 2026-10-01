import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, relative } from 'node:path';
import { expect, it } from 'vitest';
import { installSkill } from './install.js';

async function files(directory: string): Promise<readonly string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await files(path)));
    } else {
      result.push(path);
    }
  }
  return result;
}

it('installs a self-contained Discovery tree with every routed local reference and schema', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'blackbox-discovery-assets-'));
  try {
    await installSkill({ projectDirectory, skillName: 'discovery', agents: ['codex'] });
    const root = join(projectDirectory, '.agents/skills/discovery');
    const installed = await files(root);
    expect(installed).toContain(join(root, 'schemas/discovery-audit.v1.json'));
    expect(installed).toContain(join(root, 'skills/boundary/SKILL.md'));
    const links: string[] = [];
    for (const path of installed.filter((path) => path.endsWith('.md'))) {
      for (const match of (await readFile(path, 'utf8')).matchAll(/\]\(([^)]+)\)/gu)) {
        const link = match[1].split('#')[0];
        if (link.length === 0 || /^[a-z]+:/u.test(link)) {
          continue;
        }
        const target = resolve(dirname(path), link);
        expect(relative(root, target).startsWith('..'), path).toBe(false);
        await expect(access(target), `${path}: ${link}`).resolves.toBeUndefined();
        links.push(target);
      }
    }
    expect(links.length).toBeGreaterThan(25);
    await expect(access(join(projectDirectory, '.agents/skills/capsule'))).rejects.toThrow();
  } finally {
    await rm(projectDirectory, { recursive: true, force: true });
  }
});
