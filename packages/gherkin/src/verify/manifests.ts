import { readFile } from 'node:fs/promises';

import type { PolicyManifest, RunManifest } from '@suites/blackbox-playwright/reporter';

import { COMPILER_NAME, type CompileManifest } from '../compiler/manifest.js';
import { isObject } from '../project/reader.js';

// Readers for the three files `verify` joins: the compile manifest written by
// `blackbox feature compile`, and the run manifest and effective runner policy
// written by the Blackbox reporter. A file that is missing or has another
// shape is a verification problem, never a pass.

export type Read<T> = { readonly kind: 'read'; readonly value: T } | { readonly kind: 'problem'; readonly problem: string };

async function readJson(file: string, what: string, missing: string): Promise<Read<unknown>> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { kind: 'problem', problem: `no ${what} at ${file}: ${missing}` };
    }
    throw error;
  }
  try {
    return { kind: 'read', value: JSON.parse(text) as unknown };
  } catch (error) {
    return { kind: 'problem', problem: `the ${what} at ${file} is not JSON: ${(error as Error).message}` };
  }
}

const arrays = (value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean =>
  keys.every((key) => Array.isArray(value[key]));

// Shape checks for the top level; the entries are checked where verify reads them.
function isCompileManifest(value: unknown): value is CompileManifest {
  return (
    isObject(value) &&
    value.schemaVersion === 1 &&
    value.compiler === COMPILER_NAME &&
    isObject(value.library) &&
    arrays(value, ['capabilities', 'features', 'scenarios'])
  );
}

function isRunManifest(value: unknown): value is RunManifest {
  return (
    isObject(value) &&
    value.schemaVersion === 0 &&
    value.verdicts === 'strict' &&
    typeof value.status === 'string' &&
    arrays(value, ['scenarios'])
  );
}

function isPolicyManifest(value: unknown): value is PolicyManifest {
  return isObject(value) && value.schemaVersion === 1 && isObject(value.policy) && isObject(value.policy.tests);
}

export async function readCompileManifest(file: string): Promise<Read<CompileManifest>> {
  const read = await readJson(file, 'compile manifest', 'run `blackbox feature compile` first');
  if (read.kind === 'problem') {
    return read;
  }
  if (!isCompileManifest(read.value)) {
    return { kind: 'problem', problem: `the compile manifest at ${file} is not a ${COMPILER_NAME} compile manifest (schemaVersion 1)` };
  }
  return { kind: 'read', value: read.value };
}

export async function readRunManifest(file: string): Promise<Read<RunManifest>> {
  const read = await readJson(
    file,
    'run manifest',
    'the Blackbox reporter did not write one, so the run had no strict verdicts (was the reporter replaced on the command line?)',
  );
  if (read.kind === 'problem') {
    return read;
  }
  if (!isRunManifest(read.value)) {
    return { kind: 'problem', problem: `the run manifest at ${file} is not a strict-verdict run manifest (schemaVersion 0)` };
  }
  return { kind: 'read', value: read.value };
}

export async function readPolicyManifest(file: string): Promise<Read<PolicyManifest>> {
  const read = await readJson(file, 'runner-policy manifest', 'the Blackbox reporter did not record the effective runner policy');
  if (read.kind === 'problem') {
    return read;
  }
  if (!isPolicyManifest(read.value)) {
    return { kind: 'problem', problem: `the runner-policy manifest at ${file} is not a runner-policy manifest (schemaVersion 1)` };
  }
  return { kind: 'read', value: read.value };
}
