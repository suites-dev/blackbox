import { lstat, mkdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

function errorCode(error: unknown): string {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : '';
}

function within(path: string, root: string): boolean {
  const value = relative(root, path);
  return value === '' || (!value.startsWith('..') && !isAbsolute(value));
}

async function ensureDirectory(input: {
  readonly parent: string;
  readonly name: string;
  readonly projectRoot: string;
}): Promise<string> {
  const path = join(input.parent, input.name);
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') {
      throw error;
    }
  }
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`Refusing unsafe driver directory: ${path}`);
  }
  const canonical = resolve(await realpath(path));
  if (!within(canonical, input.projectRoot)) {
    throw new Error(`Driver directory escapes the project: ${path}`);
  }
  return canonical;
}

export async function driverInstallDirectory(projectDirectory: string): Promise<string> {
  const projectRoot = resolve(await realpath(projectDirectory));
  const blackbox = await ensureDirectory({
    parent: projectRoot,
    name: '.blackbox',
    projectRoot,
  });
  return await ensureDirectory({ parent: blackbox, name: 'drivers', projectRoot });
}

export async function rejectUnsafeDriverEntries(input: {
  readonly directory: string;
  readonly names: readonly string[];
}): Promise<void> {
  for (const name of input.names) {
    const path = join(input.directory, name);
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink()) {
        throw new Error(`Refusing symlinked driver path: ${path}`);
      }
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        throw error;
      }
    }
  }
}
