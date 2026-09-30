import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { SkillStoreError } from '../install-skill.js';
import { nodeSkillStore } from './node-skill-store.js';

// Concurrent changes and recovery of leftovers from an interrupted run.

const DESTINATION = '.agents/skills/discovery';
const files = (entries: Record<string, string>) =>
  new Map(Object.entries(entries).map(([path, content]) => [path, Buffer.from(content)]));

async function withProject(run: (project: string) => Promise<void>): Promise<void> {
  const project = await mkdtemp(join(tmpdir(), 'skill-store-changes-'));
  try {
    await run(project);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
}

async function rejectsAsChanged(promise: Promise<unknown>) {
  const error: unknown = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(SkillStoreError);
  expect((error as SkillStoreError).reason).toBe('changed-during-install');
  expect((error as SkillStoreError).message).toMatch(/changed while installing/u);
}

it('a destination edited after it was assessed is put back, not replaced', async () => {
  await withProject(async (project) => {
    const skill = join(project, DESTINATION, 'SKILL.md');
    const store = nodeSkillStore(project);
    await store.replace(DESTINATION, files({ 'SKILL.md': 'v1\n' }), await store.read(DESTINATION));
    const assessed = await store.read(DESTINATION);
    const editing = nodeSkillStore(project, {
      afterStage: () => writeFile(skill, 'edited meanwhile\n'),
      afterRetire: () => Promise.resolve(),
    });
    await rejectsAsChanged(editing.replace(DESTINATION, files({ 'SKILL.md': 'v2\n' }), assessed));
    expect(await readFile(skill, 'utf8')).toBe('edited meanwhile\n');
    expect(await readdir(join(project, '.agents', 'skills'))).toEqual(['discovery']);
  });
});

it('a destination created after it was assessed as absent is left alone', async () => {
  await withProject(async (project) => {
    const assessed = await nodeSkillStore(project).read(DESTINATION);
    const creating = nodeSkillStore(project, {
      afterStage: async () => {
        await mkdir(join(project, DESTINATION));
        await writeFile(join(project, DESTINATION, 'SKILL.md'), 'someone else\n');
      },
      afterRetire: () => Promise.resolve(),
    });
    await rejectsAsChanged(creating.replace(DESTINATION, files({ 'SKILL.md': 'v1\n' }), assessed));
    expect(await readFile(join(project, DESTINATION, 'SKILL.md'), 'utf8')).toBe('someone else\n');
    expect(await readdir(join(project, '.agents', 'skills'))).toEqual(['discovery']);
  });
});

it('a destination removed after it was assessed is not recreated', async () => {
  await withProject(async (project) => {
    const store = nodeSkillStore(project);
    await store.replace(DESTINATION, files({ 'SKILL.md': 'v1\n' }), await store.read(DESTINATION));
    const assessed = await store.read(DESTINATION);
    const removing = nodeSkillStore(project, {
      afterStage: () => rm(join(project, DESTINATION), { recursive: true }),
      afterRetire: () => Promise.resolve(),
    });
    await rejectsAsChanged(removing.replace(DESTINATION, files({ 'SKILL.md': 'v2\n' }), assessed));
    expect(await readdir(join(project, '.agents', 'skills'))).toEqual([]);
  });
});

it('an edit that lands in the retired tree during the swap is kept', async () => {
  await withProject(async (project) => {
    const skills = join(project, '.agents', 'skills');
    const store = nodeSkillStore(project);
    await store.replace(DESTINATION, files({ 'SKILL.md': 'v1\n' }), await store.read(DESTINATION));
    const assessed = await store.read(DESTINATION);
    // Simulates a write through a file handle opened before the swap.
    const lateWrite = nodeSkillStore(project, {
      afterStage: () => Promise.resolve(),
      afterRetire: async () => {
        const [retired] = (await readdir(skills)).filter((entry) => entry.includes('blackbox-old'));
        await writeFile(join(skills, retired, 'SKILL.md'), 'late edit\n');
      },
    });
    await rejectsAsChanged(lateWrite.replace(DESTINATION, files({ 'SKILL.md': 'v2\n' }), assessed));
    expect(await readFile(join(project, DESTINATION, 'SKILL.md'), 'utf8')).toBe('late edit\n');
    expect(await readdir(skills)).toEqual(['discovery']);
  });
});

it('an empty directory inside a skill is part of what is read', async () => {
  await withProject(async (project) => {
    const store = nodeSkillStore(project);
    await store.replace(DESTINATION, files({ 'SKILL.md': 'v1\n' }), await store.read(DESTINATION));
    await mkdir(join(project, DESTINATION, 'notes'));
    const read = await store.read(DESTINATION);
    expect(read.kind === 'directory' ? [...read.files.keys()].sort() : []).toEqual([
      'SKILL.md',
      'notes/',
    ]);
  });
});

it('stale siblings are removed on read once the destination exists', async () => {
  await withProject(async (project) => {
    const skills = join(project, '.agents', 'skills');
    await mkdir(join(skills, 'discovery'), { recursive: true });
    await writeFile(join(skills, 'discovery', 'SKILL.md'), 'current\n');
    // A crash after the swap finished leaves the retired tree; an interrupted
    // record write leaves a staged file.
    await mkdir(join(skills, '.discovery.blackbox-old-0123456789abcdef'));
    await writeFile(join(skills, '.discovery.blackbox-tmp-fedcba9876543210'), 'record');
    expect((await nodeSkillStore(project).read(DESTINATION)).kind).toBe('directory');
    expect(await readdir(skills)).toEqual(['discovery']);
  });
});

it('several retired trees without a destination are kept for the user', async () => {
  await withProject(async (project) => {
    const skills = join(project, '.agents', 'skills');
    const retired = [
      '.discovery.blackbox-old-0123456789abcdef',
      '.discovery.blackbox-old-1123456789abcdef',
    ];
    for (const entry of retired) {
      await mkdir(join(skills, entry), { recursive: true });
    }
    expect(await nodeSkillStore(project).read(DESTINATION)).toEqual({ kind: 'absent' });
    expect((await readdir(skills)).sort()).toEqual(retired);
  });
});
