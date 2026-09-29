import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { isCapsuleIdShape } from './identifiers.js';

/**
 * The project's current capsule: `.blackbox/state/current-capsule` holding the
 * capsule ID and a newline. Every operation is lock-free and uses only atomic
 * filesystem primitives available on Linux, macOS and Windows (rename, link).
 */
export const CURRENT_CAPSULE_RELATIVE_PATH = '.blackbox/state/current-capsule';

export type CurrentCapsuleRead =
  | { readonly kind: 'none' }
  | { readonly kind: 'set'; readonly capsule: string }
  | { readonly kind: 'invalid'; readonly reason: 'unreadable' | 'malformed' };

export type ClearResult = 'cleared' | 'not-current' | 'restored';

/** Test seams between the compare-and-clear steps. */
export interface ClearHooks {
  readonly afterRead: () => Promise<void>;
  readonly afterRename: () => Promise<void>;
}

const NO_HOOKS = {
  afterRead: () => Promise.resolve(),
  afterRename: () => Promise.resolve(),
} satisfies ClearHooks;

export function stateDirectory(projectDirectory: string): string {
  return join(projectDirectory, '.blackbox', 'state');
}

function token(): string {
  return randomBytes(8).toString('hex');
}

function errorCode(error: unknown): string {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : '';
}

function within(path: string, root: string): boolean {
  const value = relative(root, path);
  return value === '' || (!value.startsWith('..') && !isAbsolute(value));
}

/**
 * The state directory, verified before any mutation: `.blackbox` and `state`
 * must be real directories (not symlinks) whose canonical path stays inside the
 * canonical project directory, as driver installation already requires. With
 * `create`, missing directories are created (mode 0700); without it, a missing
 * directory yields null. Anything unsafe throws and nothing is written.
 */
async function safeStateDirectory(
  projectDirectory: string,
  create: boolean,
): Promise<string | null> {
  const root = resolve(await realpath(projectDirectory));
  let directory = root;
  for (const name of ['.blackbox', 'state']) {
    const path = join(directory, name);
    if (create) {
      await mkdir(path, { mode: 0o700 }).catch((error: unknown) => {
        if (errorCode(error) !== 'EEXIST') {
          throw error;
        }
      });
    }
    let info;
    try {
      info = await lstat(path);
    } catch (error) {
      if (!create && errorCode(error) === 'ENOENT') {
        return null;
      }
      throw error;
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw Object.assign(new Error(`Refusing unsafe state directory: ${path}`), {
        code: 'EUNSAFE',
      });
    }
    directory = resolve(await realpath(path));
    if (!within(directory, root)) {
      throw Object.assign(new Error(`State directory escapes the project: ${path}`), {
        code: 'EUNSAFE',
      });
    }
  }
  return directory;
}

function parseContent(content: string): string | null {
  const value = content.endsWith('\n') ? content.slice(0, -1) : content;
  return isCapsuleIdShape(value) ? value : null;
}

/** A capsule ID plus newline is far shorter; anything longer is malformed. */
const MAX_CURRENT_BYTES = 256;

/**
 * Reads the file only when it is a regular file, never a symlink, FIFO or
 * device, and reads at most MAX_CURRENT_BYTES + 1 bytes. null = unreadable.
 */
async function readBounded(file: string): Promise<string | null> {
  const info = await lstat(file);
  if (!info.isFile()) {
    return null;
  }
  // O_NOFOLLOW and O_NONBLOCK close the lstat/open race: a file swapped for a
  // symlink fails to open, and one swapped for a FIFO opens without blocking and
  // fails the fstat check below. Windows has neither flag; there the constants
  // are undefined and the bitwise OR treats them as 0.
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!(await handle.stat()).isFile()) {
      return null;
    }
    const buffer = Buffer.alloc(MAX_CURRENT_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return bytesRead > MAX_CURRENT_BYTES ? '' : buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

/**
 * The current capsule, read only through a safe state directory (see
 * safeStateDirectory) and a bounded read of a regular file. An unsafe
 * directory or file reads as `unreadable`; a missing one as `none`.
 */
export async function readCurrentCapsule(projectDirectory: string): Promise<CurrentCapsuleRead> {
  let content: string | null;
  try {
    const directory = await safeStateDirectory(projectDirectory, false);
    if (directory === null) {
      return { kind: 'none' };
    }
    content = await readBounded(join(directory, 'current-capsule'));
  } catch (error) {
    return errorCode(error) === 'ENOENT'
      ? { kind: 'none' }
      : { kind: 'invalid', reason: 'unreadable' };
  }
  if (content === null) {
    return { kind: 'invalid', reason: 'unreadable' };
  }
  const capsule = parseContent(content);
  return capsule === null ? { kind: 'invalid', reason: 'malformed' } : { kind: 'set', capsule };
}

/**
 * set(X): write a uniquely named temp file, then rename it over the file. Last
 * writer wins. A failure is reported without the temp file's random name.
 */
export async function setCurrentCapsule(projectDirectory: string, capsule: string): Promise<void> {
  let temporary: string | null = null;
  try {
    const directory = await safeStateDirectory(projectDirectory, true);
    if (directory === null) {
      throw new Error('state directory missing after creation');
    }
    temporary = join(directory, `current-capsule.${String(process.pid)}.${token()}.tmp`);
    await writeFile(temporary, `${capsule}\n`, { flag: 'wx', mode: 0o600 });
    await rename(temporary, join(directory, 'current-capsule'));
  } catch (error) {
    if (temporary !== null) {
      await unlink(temporary).catch(() => undefined);
    }
    const code = errorCode(error);
    throw new Error(`${code === '' ? 'error' : code} writing ${CURRENT_CAPSULE_RELATIVE_PATH}`, {
      cause: error,
    });
  }
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * clearIf(A): clears the file only while it still names A. A set() that lands
 * between the read and the rename is restored with link(); a newer set() that
 * already exists (EEXIST) wins over the restore.
 */
export async function clearCurrentCapsuleIf(
  projectDirectory: string,
  capsule: string,
  hooks: ClearHooks = NO_HOOKS,
): Promise<ClearResult> {
  try {
    return await clearIf(projectDirectory, capsule, hooks);
  } catch (error) {
    const code = errorCode(error);
    throw new Error(`${code === '' ? 'error' : code} clearing ${CURRENT_CAPSULE_RELATIVE_PATH}`, {
      cause: error,
    });
  }
}

async function clearIf(
  projectDirectory: string,
  capsule: string,
  hooks: ClearHooks,
): Promise<ClearResult> {
  const directory = await safeStateDirectory(projectDirectory, false);
  if (directory === null) {
    return 'not-current';
  }
  const file = join(directory, 'current-capsule');
  const before = await readIfPresent(file);
  if (before === null || parseContent(before) !== capsule) {
    return 'not-current';
  }
  await hooks.afterRead();
  const clearing = join(directory, `current-capsule.clearing-${token()}`);
  try {
    await rename(file, clearing);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return 'not-current';
    }
    throw error;
  }
  await hooks.afterRename();
  const moved = await readFile(clearing, 'utf8');
  if (parseContent(moved) === capsule) {
    await unlink(clearing);
    return 'cleared';
  }
  try {
    await link(clearing, file);
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') {
      throw error;
    }
  }
  await unlink(clearing);
  return 'restored';
}
