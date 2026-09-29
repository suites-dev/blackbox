import { randomBytes } from 'node:crypto';
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { INSTALL_RECORD_NAME } from '../install-record.js';
import type { SkillStore, StoredSkill } from '../install-skill.js';
import {
  asStoreError,
  lstatOrNull,
  readSkillTree,
  safeParent,
  segments,
  unsafe,
} from './safe-paths.js';

export { readSkillTree } from './safe-paths.js';

/** Test seams inside `replace`, between its filesystem steps. */
export interface ReplaceHooks {
  /** After the new tree (or record) is fully written to its temporary sibling. */
  readonly afterStage: () => Promise<void>;
  /** After the previous tree is moved aside, before the new one is moved in. */
  readonly afterRetire: () => Promise<void>;
}

const NO_HOOKS = {
  afterStage: () => Promise.resolve(),
  afterRetire: () => Promise.resolve(),
} satisfies ReplaceHooks;

const token = () => randomBytes(8).toString('hex');
const temporaryName = (name: string, kind: 'tmp' | 'old') => `.${name}.blackbox-${kind}-${token()}`;
const temporaryPattern = (name: string, kind: 'tmp' | 'old') =>
  new RegExp(`^\\.${name.replaceAll('.', '\\.')}\\.blackbox-${kind}-[0-9a-f]{16}$`, 'u');

async function siblings(parent: string, name: string, kind: 'tmp' | 'old'): Promise<string[]> {
  const pattern = temporaryPattern(name, kind);
  return (await readdir(parent)).filter((entry) => pattern.test(entry)).sort();
}

/**
 * An install interrupted between moving the previous tree aside and moving the
 * new one in leaves no destination and one retired sibling. Put it back so the
 * next run judges the content that was there, never an empty destination.
 */
async function restoreInterrupted(parent: string, name: string): Promise<void> {
  if ((await lstatOrNull(join(parent, name))) !== null) {
    return;
  }
  const retired = await siblings(parent, name, 'old');
  if (retired.length === 1) {
    await rename(join(parent, retired[0]), join(parent, name));
  }
}

/** Removes temporary trees left by an earlier interrupted run. */
async function removeStale(parent: string, name: string): Promise<void> {
  for (const kind of ['tmp', 'old'] as const) {
    for (const entry of await siblings(parent, name, kind)) {
      await rm(join(parent, entry), { recursive: true, force: true });
    }
  }
}

async function stage(directory: string, files: ReadonlyMap<string, Uint8Array>): Promise<void> {
  await mkdir(directory);
  for (const path of [...files.keys()].sort()) {
    const target = join(directory, ...segments(path));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, files.get(path) ?? new Uint8Array(), { flag: 'wx' });
  }
}

async function readStored(projectDirectory: string, path: string): Promise<StoredSkill> {
  const parts = segments(path);
  const name = parts[parts.length - 1];
  const parent = await safeParent(projectDirectory, parts, false);
  if (parent === null) {
    return { kind: 'absent' };
  }
  await restoreInterrupted(parent, name);
  const destination = join(parent, name);
  const info = await lstatOrNull(destination);
  if (info === null) {
    return { kind: 'absent' };
  }
  if (info.isSymbolicLink()) {
    throw unsafe(`Refusing symlinked skill directory: ${destination}`);
  }
  if (!info.isDirectory()) {
    return { kind: 'other' };
  }
  return { kind: 'directory', files: await readSkillTree(destination) };
}

/** Moves `staged` into place, restoring the previous tree if the swap fails. */
async function swapIn(input: {
  readonly parent: string;
  readonly name: string;
  readonly staged: string;
  readonly hooks: ReplaceHooks;
}): Promise<void> {
  const destination = join(input.parent, input.name);
  const info = await lstatOrNull(destination);
  if (info === null) {
    await rename(input.staged, destination);
    return;
  }
  if (info.isSymbolicLink()) {
    throw unsafe(`Refusing symlinked skill directory: ${destination}`);
  }
  const retired = join(input.parent, temporaryName(input.name, 'old'));
  await rename(destination, retired);
  try {
    await input.hooks.afterRetire();
    await rename(input.staged, destination);
  } catch (error) {
    await rename(retired, destination);
    throw error;
  }
  await rm(retired, { recursive: true, force: true });
}

async function replaceTree(
  projectDirectory: string,
  hooks: ReplaceHooks,
  path: string,
  files: ReadonlyMap<string, Uint8Array>,
): Promise<void> {
  let staged: string | null = null;
  try {
    const parts = segments(path);
    const name = parts[parts.length - 1];
    const parent = await safeParent(projectDirectory, parts, true);
    if (parent === null) {
      throw unsafe(`Cannot create skill directory: ${path}`);
    }
    await restoreInterrupted(parent, name);
    await removeStale(parent, name);
    staged = join(parent, temporaryName(name, 'tmp'));
    await stage(staged, files);
    await hooks.afterStage();
    await swapIn({ parent, name, staged, hooks });
    staged = null;
  } catch (error) {
    if (staged !== null) {
      await rm(staged, { recursive: true, force: true }).catch(() => undefined);
    }
    throw error;
  }
}

async function writeRecordFile(
  projectDirectory: string,
  hooks: ReplaceHooks,
  path: string,
  content: Uint8Array,
): Promise<void> {
  let staged: string | null = null;
  try {
    const parts = segments(path);
    const name = parts[parts.length - 1];
    const parent = await safeParent(projectDirectory, parts, false);
    const info = parent === null ? null : await lstatOrNull(join(parent, name));
    if (parent === null || info === null || info.isSymbolicLink() || !info.isDirectory()) {
      throw unsafe(`Refusing to record an unsafe skill directory: ${path}`);
    }
    const record = join(parent, name, INSTALL_RECORD_NAME);
    if ((await lstatOrNull(record)) !== null) {
      throw unsafe(`Refusing to replace an existing install record: ${record}`);
    }
    // Staged beside the skill, never inside it, so an interrupted write
    // leaves no extra file in the skill directory.
    staged = join(parent, temporaryName(name, 'tmp'));
    await writeFile(staged, content, { flag: 'wx' });
    await hooks.afterStage();
    await rename(staged, record);
    staged = null;
  } catch (error) {
    if (staged !== null) {
      await rm(staged, { force: true }).catch(() => undefined);
    }
    throw error;
  }
}

/**
 * Skill directories under a project, written by swapping a fully staged sibling
 * into place with `rename`, so an interrupted install never leaves a partial
 * skill. Symlinks are never followed at any level.
 */
export function nodeSkillStore(
  projectDirectory: string,
  hooks: ReplaceHooks = NO_HOOKS,
): SkillStore {
  const storeErrors =
    <Args extends unknown[], Result>(operation: (...args: Args) => Promise<Result>) =>
    async (...args: Args): Promise<Result> => {
      try {
        return await operation(...args);
      } catch (error) {
        throw asStoreError(error);
      }
    };
  return {
    read: storeErrors((path: string) => readStored(projectDirectory, path)),
    replace: storeErrors((path: string, files: ReadonlyMap<string, Uint8Array>) =>
      replaceTree(projectDirectory, hooks, path, files),
    ),
    writeRecord: storeErrors((path: string, content: Uint8Array) =>
      writeRecordFile(projectDirectory, hooks, path, content),
    ),
  };
}
