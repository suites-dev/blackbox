import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';

import { isObject, type JsonObject } from '../project/reader.js';
import { packedPackage } from './tarball.js';

// Rule 3: the shared step library and the runtime that runs it are used as
// published. A project may not patch them or point them at a fork. These
// checks read the package manifests and patch folders from the project
// directory up to its repository root.

/** The packages whose code decides which steps exist and what they claim. */
export const PROTECTED_PACKAGES = ['@suites/blackbox-gherkin', '@suites/blackbox-playwright'] as const;

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;
// Sources other than a registry version or the workspace.
const FORK_SOURCE = /^(?:file:|link:|portal:|patch:|git\+|git:|github:|gitlab:|bitbucket:|https?:|\.{0,2}\/)/u;
// A package tarball on disk, as `npm pack` or `pnpm pack` writes it.
const LOCAL_TARBALL = /^file:(.+\.(?:tgz|tar\.gz))$/u;

// src/check and dist/check sit at the same depth below the package root.
// Releases are fixed-version, so every protected package carries this version.
const RELEASE = (createRequire(import.meta.url)('../../package.json') as { readonly version: string }).version;

/**
 * A protected package installed from a local tarball, as the unpublished alpha
 * is. It is accepted only when the tarball is a pack of that package at this
 * release, which packageProblems reads from the tarball itself.
 */
interface LocalTarball {
  readonly file: string;
  readonly field: string;
  readonly name: string;
  readonly value: string;
  readonly tarball: string;
}

type Finding = string | LocalTarball;

/** The protected package a dependency, override or resolution key names (`name`, `name@range`, `a>name`, `**\/name`). */
function protectedKey(key: string): string | null {
  return PROTECTED_PACKAGES.find((name) => new RegExp(`(?:^|[>/])${name.replace('/', '\\/')}(?:@|$)`, 'u').test(key)) ?? null;
}

function forkProblem(where: Where, field: string, key: string, value: unknown): Finding | null {
  const { file } = where;
  const name = protectedKey(key);
  if (name === null || typeof value !== 'string') {
    return null;
  }
  const local = LOCAL_TARBALL.exec(value);
  if (local !== null) {
    return { file, field, name, value, tarball: resolve(where.directory, local[1]) };
  }
  const alias = /^npm:(@?[^@]+)/u.exec(value);
  if (FORK_SOURCE.test(value) || (alias !== null && alias[1] !== name)) {
    return `${file}: ${field} points ${name} at ${JSON.stringify(value)}; use the published package`;
  }
  return null;
}

/** A package manifest: its path as reported, and the directory its relative sources resolve from. */
interface Where {
  readonly file: string;
  readonly directory: string;
}

/** Dependency and override entries; npm `overrides` nest by dependency path, so every level is read. */
function entryProblems(where: Where, field: string, entries: JsonObject): Finding[] {
  const problems: (Finding | null)[] = [];
  for (const [key, value] of Object.entries(entries)) {
    if (isObject(value)) {
      // "." is the override of the package itself when it also overrides its dependencies.
      problems.push(forkProblem(where, field, key, value['.']), ...entryProblems(where, `${field} > ${key}`, value));
    } else {
      problems.push(forkProblem(where, field, key, value));
    }
  }
  return problems.filter((problem): problem is Finding => problem !== null);
}

function manifestProblems(where: Where, manifest: JsonObject): Finding[] {
  const { file } = where;
  const problems: Finding[] = [];
  for (const field of DEPENDENCY_FIELDS) {
    const entries = manifest[field];
    if (isObject(entries)) {
      problems.push(...entryProblems(where, field, entries));
    }
  }
  const pnpm = isObject(manifest.pnpm) ? manifest.pnpm : {};
  for (const [field, value] of [
    ['overrides', manifest.overrides],
    ['resolutions', manifest.resolutions],
    ['pnpm.overrides', pnpm.overrides],
  ] as const) {
    if (isObject(value)) {
      problems.push(...entryProblems(where, field, value));
    }
  }
  const patched = isObject(pnpm.patchedDependencies) ? Object.keys(pnpm.patchedDependencies) : [];
  for (const key of patched.filter((candidate) => protectedKey(candidate) !== null)) {
    problems.push(`${file}: pnpm.patchedDependencies patches ${key}; the step library and its runtime may not be patched`);
  }
  return problems;
}

/** pnpm 10 keeps overrides and patches in pnpm-workspace.yaml; any entry there naming a protected package is refused. */
function workspaceProblems(file: string, text: string): string[] {
  let section = '';
  const problems: string[] = [];
  for (const line of text.split(/\r?\n/u)) {
    const top = /^([A-Za-z][\w-]*):/u.exec(line);
    if (top !== null) {
      section = top[1];
    } else if (['overrides', 'patchedDependencies'].includes(section)) {
      const key = /^\s+['"]?([^'":]+)['"]?\s*:/u.exec(line);
      if (key !== null && protectedKey(key[1]) !== null) {
        problems.push(`${file}: ${section} names ${key[1]}; the step library and its runtime are used as published`);
      }
    }
  }
  return problems;
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      return null;
    }
    throw error;
  }
}

async function patchProblems(directory: string, shown: (path: string) => string): Promise<string[]> {
  let names: readonly string[];
  try {
    names = await readdir(join(directory, 'patches'));
  } catch {
    return [];
  }
  // pnpm writes @suites__blackbox-gherkin@x.patch, patch-package @suites+blackbox-gherkin+x.patch.
  return names
    .filter((name) => /blackbox-(?:gherkin|playwright)/u.test(name))
    .map((name) => `${shown(join(directory, 'patches', name))}: patches a protected package; the step library and its runtime may not be patched`);
}

/** Null when a local tarball is a pack of its protected package at this release; otherwise why not. */
async function tarballProblem(use: LocalTarball): Promise<string | null> {
  const packed = await packedPackage(use.tarball);
  const points = `${use.file}: ${use.field} points ${use.name} at ${JSON.stringify(use.value)}`;
  if (packed === null) {
    return `${points}, which is not a readable package tarball; use the published package or a pack of ${use.name}@${RELEASE}`;
  }
  if (packed.name !== use.name || packed.version !== RELEASE) {
    return `${points}, a pack of ${packed.name}@${packed.version}; a local tarball must be a pack of ${use.name}@${RELEASE}`;
  }
  return null;
}

/** Every patch or fork of a protected package between the project directory and the repository root. */
export async function packageProblems(projectRoot: string, repositoryRoot: string): Promise<readonly string[]> {
  const shown = (path: string) => relative(projectRoot, path) || '.';
  const problems: string[] = [];
  for (let directory = projectRoot; ; directory = dirname(directory)) {
    const manifest = await readOptional(join(directory, 'package.json'));
    if (manifest !== null) {
      const parsed: unknown = JSON.parse(manifest);
      const findings = isObject(parsed) ? manifestProblems({ file: shown(join(directory, 'package.json')), directory }, parsed) : [];
      for (const finding of findings) {
        const problem = typeof finding === 'string' ? finding : await tarballProblem(finding);
        if (problem !== null) {
          problems.push(problem);
        }
      }
    }
    const workspace = await readOptional(join(directory, 'pnpm-workspace.yaml'));
    if (workspace !== null) {
      problems.push(...workspaceProblems(shown(join(directory, 'pnpm-workspace.yaml')), workspace));
    }
    problems.push(...(await patchProblems(directory, shown)));
    if (directory === repositoryRoot || dirname(directory) === directory) {
      return problems;
    }
  }
}
