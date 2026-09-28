import { randomBytes } from 'node:crypto';
import { link, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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

function currentFile(projectDirectory: string): string {
  return join(stateDirectory(projectDirectory), 'current-capsule');
}

function token(): string {
  return randomBytes(8).toString('hex');
}

function errorCode(error: unknown): string {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : '';
}

function parseContent(content: string): string | null {
  const value = content.endsWith('\n') ? content.slice(0, -1) : content;
  return isCapsuleIdShape(value) ? value : null;
}

export async function readCurrentCapsule(projectDirectory: string): Promise<CurrentCapsuleRead> {
  let content: string;
  try {
    content = await readFile(currentFile(projectDirectory), 'utf8');
  } catch (error) {
    return errorCode(error) === 'ENOENT'
      ? { kind: 'none' }
      : { kind: 'invalid', reason: 'unreadable' };
  }
  const capsule = parseContent(content);
  return capsule === null ? { kind: 'invalid', reason: 'malformed' } : { kind: 'set', capsule };
}

/**
 * set(X): write a uniquely named temp file, then rename it over the file. Last
 * writer wins. A failure is reported without the temp file's random name.
 */
export async function setCurrentCapsule(projectDirectory: string, capsule: string): Promise<void> {
  const directory = stateDirectory(projectDirectory);
  const temporary = join(directory, `current-capsule.${String(process.pid)}.${token()}.tmp`);
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(temporary, `${capsule}\n`, { flag: 'wx', mode: 0o600 });
    await rename(temporary, currentFile(projectDirectory));
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
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
  const file = currentFile(projectDirectory);
  const before = await readIfPresent(file);
  if (before === null || parseContent(before) !== capsule) {
    return 'not-current';
  }
  await hooks.afterRead();
  const clearing = join(stateDirectory(projectDirectory), `current-capsule.clearing-${token()}`);
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
