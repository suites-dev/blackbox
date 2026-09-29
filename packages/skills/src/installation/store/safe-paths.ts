import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { SkillStoreError } from '../install-skill.js';

export function errorCode(error: unknown): string {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : '';
}

function within(path: string, root: string): boolean {
  const value = relative(root, path);
  return value === '' || (!value.startsWith('..') && !isAbsolute(value));
}

export function unsafe(message: string): SkillStoreError {
  return new SkillStoreError('unsafe-path', message);
}

export function asStoreError(error: unknown): SkillStoreError {
  if (error instanceof SkillStoreError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  const code = errorCode(error);
  return new SkillStoreError(
    code === 'EACCES' || code === 'EPERM' || code === 'EROFS' ? 'permission-denied' : 'io-error',
    message,
  );
}

export function segments(path: string): readonly string[] {
  const parts = path.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..' || part.includes('\\'))) {
    throw unsafe(`Refusing unsafe skill path: ${path}`);
  }
  return parts;
}

/**
 * Opens without following a symlink, so an entry swapped for a link after the
 * directory listing is refused rather than read through.
 */
async function readRegularFile(path: string): Promise<Uint8Array> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).catch((error: unknown) => {
    throw errorCode(error) === 'ELOOP' ? unsafe(`Refusing symlinked skill path: ${path}`) : error;
  });
  try {
    if (!(await handle.stat()).isFile()) {
      throw unsafe(`Refusing special file in skill directory: ${path}`);
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

/**
 * Reads a skill tree: only real directories and regular files. Any symlink or
 * special file inside it is refused rather than followed.
 */
export async function readSkillTree(directory: string): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  async function walk(current: string, prefix: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      const key = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        throw unsafe(`Refusing symlinked skill path: ${path}`);
      }
      if (entry.isDirectory()) {
        await walk(path, key);
      } else if (entry.isFile()) {
        files.set(key, await readRegularFile(path));
      } else {
        throw unsafe(`Refusing special file in skill directory: ${path}`);
      }
    }
  }
  await walk(directory, '');
  return files;
}

export async function lstatOrNull(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * The canonical parent directory of a destination. Every component must be a
 * real directory (never a symlink) whose canonical path stays inside the
 * canonical project directory, as driver installation requires. With `create`,
 * missing components are created; without it, a missing one yields null.
 */
export async function safeParent(
  projectDirectory: string,
  parts: readonly string[],
  create: boolean,
): Promise<string | null> {
  const root = resolve(await realpath(projectDirectory));
  let directory = root;
  for (const name of parts.slice(0, -1)) {
    const path = join(directory, name);
    if (create) {
      await mkdir(path).catch((error: unknown) => {
        if (errorCode(error) !== 'EEXIST') {
          throw error;
        }
      });
    }
    const info = await lstatOrNull(path);
    if (info === null) {
      return null;
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw unsafe(`Refusing unsafe skill directory: ${path}`);
    }
    directory = resolve(await realpath(path));
    if (!within(directory, root)) {
      throw unsafe(`Skill directory escapes the project: ${path}`);
    }
  }
  return directory;
}
