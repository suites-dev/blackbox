import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { RuntimeInstrumentationFile } from './model.js';

export interface FileInspection {
  readonly kind: 'missing' | 'current' | 'conflict';
  readonly path: string;
  readonly file: RuntimeInstrumentationFile;
}

function errorCode(error: unknown): string {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return '';
}

async function inspectFile(
  directory: string,
  file: RuntimeInstrumentationFile,
): Promise<FileInspection> {
  const path = join(directory, file.name);
  try {
    const actual = await readFile(path, 'utf8');
    return { kind: actual === file.content ? 'current' : 'conflict', path, file };
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return { kind: 'missing', path, file };
    }
    throw error;
  }
}

export async function inspectFiles(
  directory: string,
  files: readonly RuntimeInstrumentationFile[],
): Promise<readonly FileInspection[]> {
  return await Promise.all(files.map(async (file) => await inspectFile(directory, file)));
}

export async function writeMissingFiles(
  inspections: readonly FileInspection[],
): Promise<'created' | 'unchanged'> {
  let created = false;
  for (const inspection of inspections) {
    if (inspection.kind !== 'missing') {
      continue;
    }
    await writeFile(inspection.path, inspection.file.content, { encoding: 'utf8', flag: 'wx' });
    created = true;
  }
  return created ? 'created' : 'unchanged';
}
