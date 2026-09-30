import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { SkillStoreError, type SkillStore } from '../install-skill.js';
import { nodeSkillStore } from './node-skill-store.js';

const DESTINATION = '.agents/skills/discovery';
const files = (entries: Record<string, string>) =>
  new Map(Object.entries(entries).map(([path, content]) => [path, Buffer.from(content)]));
const record = Buffer.from('{"record":true}\n');
const ABSENT = { kind: 'absent' } as const;
/** Replaces the destination after reading it, as the installer does. */
const replaceRead = async (store: SkillStore, entries: Record<string, string>) =>
  store.replace(DESTINATION, files(entries), await store.read(DESTINATION));
const failAt = (hook: 'afterStage' | 'afterRetire') => ({
  afterStage: () =>
    hook === 'afterStage' ? Promise.reject(new Error('interrupted')) : Promise.resolve(),
  afterRetire: () =>
    hook === 'afterRetire' ? Promise.reject(new Error('interrupted')) : Promise.resolve(),
});

async function withProject(run: (project: string) => Promise<void>): Promise<void> {
  const project = await mkdtemp(join(tmpdir(), 'skill-store-'));
  try {
    await run(project);
  } finally {
    await chmod(join(project, '.agents', 'skills'), 0o755).catch(() => undefined);
    await rm(project, { recursive: true, force: true });
  }
}

async function withOutside(run: (outside: string) => Promise<void>): Promise<void> {
  const outside = await mkdtemp(join(tmpdir(), 'skill-store-outside-'));
  try {
    await run(outside);
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
}

async function tree(directory: string): Promise<string[]> {
  return (await readdir(directory, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(directory.length + 1))
    .sort();
}

async function rejectsWith(promise: Promise<unknown>, reason: string, pattern: RegExp) {
  const error: unknown = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(SkillStoreError);
  expect((error as SkillStoreError).reason).toBe(reason);
  expect((error as SkillStoreError).message).toMatch(pattern);
}

it('replace creates the tree, and later swaps it whole, leaving siblings alone', async () => {
  await withProject(async (project) => {
    const store = nodeSkillStore(project);
    expect(await store.read(DESTINATION)).toEqual({ kind: 'absent' });
    await mkdir(join(project, '.agents', 'skills', 'mine'), { recursive: true });
    await writeFile(join(project, '.agents', 'skills', 'mine', 'SKILL.md'), 'mine\n');
    await replaceRead(store, { 'SKILL.md': 'v1\n', 'references/a.md': 'a\n' });
    const read = await store.read(DESTINATION);
    expect(read.kind === 'directory' ? [...read.files.keys()].sort() : []).toEqual([
      'SKILL.md',
      'references/a.md',
    ]);
    await replaceRead(store, { 'SKILL.md': 'v2\n' });
    expect(await tree(join(project, DESTINATION))).toEqual(['SKILL.md']);
    expect(await readFile(join(project, DESTINATION, 'SKILL.md'), 'utf8')).toBe('v2\n');
    expect((await readdir(join(project, '.agents', 'skills'))).sort()).toEqual([
      'discovery',
      'mine',
    ]);
    expect(await readFile(join(project, '.agents', 'skills', 'mine', 'SKILL.md'), 'utf8')).toBe(
      'mine\n',
    );
  });
});

it('an install interrupted while staging leaves the previous tree and no residue', async () => {
  await withProject(async (project) => {
    await replaceRead(nodeSkillStore(project), { 'SKILL.md': 'v1\n' });
    const interrupted = nodeSkillStore(project, failAt('afterStage'));
    await rejectsWith(replaceRead(interrupted, { 'SKILL.md': 'v2\n' }), 'io-error', /interrupted/u);
    expect(await readFile(join(project, DESTINATION, 'SKILL.md'), 'utf8')).toBe('v1\n');
    expect(await readdir(join(project, '.agents', 'skills'))).toEqual(['discovery']);
  });
});

it('an install interrupted mid-swap restores the previous tree', async () => {
  await withProject(async (project) => {
    await replaceRead(nodeSkillStore(project), { 'SKILL.md': 'v1\n' });
    const interrupted = nodeSkillStore(project, failAt('afterRetire'));
    await rejectsWith(replaceRead(interrupted, { 'SKILL.md': 'v2\n' }), 'io-error', /interrupted/u);
    expect(await readFile(join(project, DESTINATION, 'SKILL.md'), 'utf8')).toBe('v1\n');
    expect(await readdir(join(project, '.agents', 'skills'))).toEqual(['discovery']);
  });
});

it('a process killed mid-swap is recovered on the next run', async () => {
  await withProject(async (project) => {
    // State left by a crash after the old tree was moved aside: no destination,
    // the retired tree, and a staged tree.
    const skills = join(project, '.agents', 'skills');
    const retired = join(skills, '.discovery.blackbox-old-0123456789abcdef');
    const staged = join(skills, '.discovery.blackbox-tmp-fedcba9876543210');
    await mkdir(retired, { recursive: true });
    await mkdir(staged, { recursive: true });
    await writeFile(join(retired, 'SKILL.md'), 'user content\n');
    await writeFile(join(staged, 'SKILL.md'), 'half');
    const store = nodeSkillStore(project);
    const read = await store.read(DESTINATION);
    expect(read.kind).toBe('directory');
    expect(
      Buffer.from(
        (read.kind === 'directory' ? read.files.get('SKILL.md') : undefined) ?? new Uint8Array(),
      ).toString(),
    ).toBe('user content\n');
    await replaceRead(store, { 'SKILL.md': 'v2\n' });
    expect(await readdir(skills)).toEqual(['discovery']);
  });
});

it('writeRecord adds only the record; an interrupted write leaves nothing behind', async () => {
  await withProject(async (project) => {
    await mkdir(join(project, DESTINATION), { recursive: true });
    await writeFile(join(project, DESTINATION, 'SKILL.md'), 'manual\r\n');
    await rejectsWith(
      nodeSkillStore(project, failAt('afterStage')).writeRecord(DESTINATION, record),
      'io-error',
      /interrupted/u,
    );
    expect(await tree(join(project, DESTINATION))).toEqual(['SKILL.md']);
    expect(await readdir(join(project, '.agents', 'skills'))).toEqual(['discovery']);
    await nodeSkillStore(project).writeRecord(DESTINATION, record);
    expect(await tree(join(project, DESTINATION))).toEqual(['.blackbox-install.json', 'SKILL.md']);
    expect(await readFile(join(project, DESTINATION, 'SKILL.md'), 'utf8')).toBe('manual\r\n');
    await rejectsWith(
      nodeSkillStore(project).writeRecord(DESTINATION, record),
      'unsafe-path',
      /existing install record/u,
    );
  });
});

it('a symlinked destination is refused and its target is never touched', async () => {
  await withProject(async (project) => {
    await withOutside(async (outside) => {
      await writeFile(join(outside, 'SKILL.md'), 'outside\n');
      await mkdir(join(project, '.agents', 'skills'), { recursive: true });
      await symlink(outside, join(project, DESTINATION), 'dir');
      const store = nodeSkillStore(project);
      await rejectsWith(store.read(DESTINATION), 'unsafe-path', /symlinked skill directory/u);
      await rejectsWith(
        store.replace(DESTINATION, files({ 'SKILL.md': 'x' }), ABSENT),
        'unsafe-path',
        /symlinked/u,
      );
      await rejectsWith(
        store.writeRecord(DESTINATION, record),
        'unsafe-path',
        /unsafe skill directory/u,
      );
      expect(await readdir(outside)).toEqual(['SKILL.md']);
      expect(await readFile(join(outside, 'SKILL.md'), 'utf8')).toBe('outside\n');
      expect(await readdir(join(project, '.agents', 'skills'))).toEqual(['discovery']);
    });
  });
});

it('a symlinked skills directory component is refused before anything is written', async () => {
  await withProject(async (project) => {
    await withOutside(async (outside) => {
      await symlink(outside, join(project, '.agents'), 'dir');
      const store = nodeSkillStore(project);
      await rejectsWith(store.read(DESTINATION), 'unsafe-path', /unsafe skill directory/u);
      await rejectsWith(
        store.replace(DESTINATION, files({ 'SKILL.md': 'x' }), ABSENT),
        'unsafe-path',
        /unsafe skill directory/u,
      );
      await rejectsWith(
        store.writeRecord(DESTINATION, record),
        'unsafe-path',
        /unsafe skill directory/u,
      );
      expect(await readdir(outside)).toEqual([]);
    });
  });
});

it('a symlink inside an installed skill is refused rather than read', async () => {
  await withProject(async (project) => {
    await replaceRead(nodeSkillStore(project), { 'SKILL.md': 'v1\n' });
    await symlink('/etc/hostname', join(project, DESTINATION, 'leak.md'));
    await rejectsWith(
      nodeSkillStore(project).read(DESTINATION),
      'unsafe-path',
      /symlinked skill path/u,
    );
  });
});

it('paths that could escape the project are refused', async () => {
  await withProject(async (project) => {
    const store = nodeSkillStore(project);
    for (const path of [
      '../outside/discovery',
      '.agents/../../x',
      '/etc/skills',
      '.agents\\skills\\x',
    ]) {
      await rejectsWith(store.read(path), 'unsafe-path', /unsafe skill path/u);
      await rejectsWith(
        store.replace(path, files({ 'SKILL.md': 'x' }), ABSENT),
        'unsafe-path',
        /unsafe skill path/u,
      );
      await rejectsWith(store.writeRecord(path, record), 'unsafe-path', /unsafe skill path/u);
    }
    await rejectsWith(
      store.replace(DESTINATION, files({ '../escape.md': 'x' }), ABSENT),
      'unsafe-path',
      /unsafe skill path/u,
    );
    expect(await readdir(join(project, '.agents', 'skills'))).toEqual([]);
  });
});

it.skipIf(typeof process.getuid === 'function' && process.getuid() === 0)(
  'an unwritable skills directory reports permission-denied',
  async () => {
    await withProject(async (project) => {
      await mkdir(join(project, '.agents', 'skills'), { recursive: true });
      await chmod(join(project, '.agents', 'skills'), 0o555);
      await rejectsWith(
        replaceRead(nodeSkillStore(project), { 'SKILL.md': 'x' }),
        'permission-denied',
        /EACCES/u,
      );
    });
  },
);

it('a missing project directory is an io-error, not an empty install', async () => {
  const store = nodeSkillStore(join(tmpdir(), 'skill-store-missing-0123456789'));
  await rejectsWith(store.read(DESTINATION), 'io-error', /ENOENT/u);
  await rejectsWith(
    store.replace(DESTINATION, files({ 'SKILL.md': 'x' }), ABSENT),
    'io-error',
    /ENOENT/u,
  );
});
