import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

import type { SourceLocation, ValidationError } from '../feature/diagnostics.js';
import { isObject, type JsonObject } from '../project/reader.js';
import type { SentenceLibrary } from '../sentences/model.js';
import { toPosix } from '../project/files.js';
import { packedPackage } from './tarball.js';

// The step library decides what every sentence does, so a project uses it as
// published: no patch, and no dependency, override or resolution pointing it
// at a fork. A local tarball passes only when it is a pack of the library at
// the installed version, as an unpublished alpha is installed. Manifests and
// patch folders are read from the project directory up to the repository root.

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;
// Sources other than a registry version or the workspace.
const FORK_SOURCE =
  /^(?:file:|link:|portal:|patch:|git\+|git:|github:|gitlab:|bitbucket:|https?:|\.{0,2}\/)/u;
// A package tarball on disk, as `npm pack` or `pnpm pack` writes it.
const LOCAL_TARBALL = /^file:(.+\.(?:tgz|tar\.gz))$/u;

const escape = (text: string): string => text.replace(/[$()*+.?[\\\]^{|}]/gu, '\\$&');

/** A manifest being read: its path as reported, its directory and its text. */
interface Manifest {
  readonly file: string;
  readonly directory: string;
  readonly text: string;
}

interface Scope {
  readonly library: SentenceLibrary;
  readonly manifest: Manifest;
}

/** The line and column of `"key": "value"` in a manifest, else of `"key"`, else its start. */
function locate(text: string, key: string, value: string): SourceLocation {
  const keyText = escape(JSON.stringify(key));
  const found = [
    new RegExp(`${keyText}\\s*:\\s*${escape(JSON.stringify(value))}`, 'u'),
    new RegExp(keyText, 'u'),
  ]
    .map((pattern) => pattern.exec(text))
    .find((match) => match !== null);
  if (found === undefined) {
    return { line: 1, column: 1 };
  }
  const before = text.slice(0, found.index).split('\n');
  return { line: before.length, column: before[before.length - 1].length + 1 };
}

function error(file: string, location: SourceLocation, message: string): ValidationError {
  return { code: 'library-copy', file, ...location, message };
}

/** Whether a dependency, override or resolution key names the library (`name`, `name@range`, `a>name`, `**\/name`). */
function namesLibrary(key: string, library: SentenceLibrary): boolean {
  return new RegExp(`(?:^|[>/])${escape(library.name)}(?:@|$)`, 'u').test(key);
}

async function tarballProblem(
  scope: Scope,
  field: string,
  value: string,
  tarball: string,
): Promise<string | null> {
  const { name, version } = scope.library;
  const packed = await packedPackage(resolve(scope.manifest.directory, tarball));
  const points = `${field} points ${name} at ${JSON.stringify(value)}`;
  if (packed === null) {
    return `${points}, which is not a readable package tarball; use the published package or a pack of ${name}@${version}`;
  }
  if (packed.name !== name || packed.version !== version) {
    return `${points}, a pack of ${packed.name}@${packed.version}; a local tarball must be a pack of ${name}@${version}`;
  }
  return null;
}

async function forkProblem(
  scope: Scope,
  field: string,
  key: string,
  value: unknown,
): Promise<ValidationError | null> {
  if (!namesLibrary(key, scope.library) || typeof value !== 'string') {
    return null;
  }
  const { manifest, library } = scope;
  const local = LOCAL_TARBALL.exec(value);
  const alias = /^npm:(@?[^@]+)/u.exec(value);
  const problem =
    local !== null
      ? await tarballProblem(scope, field, value, local[1])
      : FORK_SOURCE.test(value) || (alias !== null && alias[1] !== library.name)
        ? `${field} points ${library.name} at ${JSON.stringify(value)}; use the published package`
        : null;
  return problem === null ? null : error(manifest.file, locate(manifest.text, key, value), problem);
}

/** Dependency and override entries; npm `overrides` nest by dependency path, so every level is read. */
async function entryProblems(
  scope: Scope,
  field: string,
  entries: JsonObject,
): Promise<ValidationError[]> {
  const problems: (ValidationError | null)[] = [];
  for (const [key, value] of Object.entries(entries)) {
    if (isObject(value)) {
      // "." is the override of the package itself when it also overrides its dependencies.
      problems.push(
        await forkProblem(scope, field, key, value['.']),
        ...(await entryProblems(scope, `${field} > ${key}`, value)),
      );
    } else {
      problems.push(await forkProblem(scope, field, key, value));
    }
  }
  return problems.filter((problem): problem is ValidationError => problem !== null);
}

async function manifestProblems(scope: Scope, manifest: JsonObject): Promise<ValidationError[]> {
  const pnpm = isObject(manifest.pnpm) ? manifest.pnpm : {};
  const fields = [
    ...DEPENDENCY_FIELDS.map((field) => [field, manifest[field]] as const),
    ['overrides', manifest.overrides],
    ['resolutions', manifest.resolutions],
    ['pnpm.overrides', pnpm.overrides],
  ] as const;
  const problems: ValidationError[] = [];
  for (const [field, entries] of fields) {
    if (isObject(entries)) {
      problems.push(...(await entryProblems(scope, field, entries)));
    }
  }
  const patched = isObject(pnpm.patchedDependencies)
    ? Object.entries(pnpm.patchedDependencies)
    : [];
  for (const [key, value] of patched.filter(([candidate]) =>
    namesLibrary(candidate, scope.library),
  )) {
    const where = locate(scope.manifest.text, key, typeof value === 'string' ? value : '');
    problems.push(
      error(
        scope.manifest.file,
        where,
        `pnpm.patchedDependencies patches ${key}; the step library may not be patched`,
      ),
    );
  }
  return problems;
}

/** pnpm 10 keeps overrides and patches in pnpm-workspace.yaml; an entry there naming the library is refused. */
function workspaceProblems(
  library: SentenceLibrary,
  file: string,
  text: string,
): ValidationError[] {
  let section = '';
  return text.split(/\r?\n/u).flatMap((line, index) => {
    const top = /^([A-Za-z][\w-]*):/u.exec(line);
    if (top !== null) {
      section = top[1];
      return [];
    }
    const key = /^(\s+)['"]?([^'":]+)['"]?\s*:/u.exec(line);
    if (
      !['overrides', 'patchedDependencies'].includes(section) ||
      key === null ||
      !namesLibrary(key[2], library)
    ) {
      return [];
    }
    return [
      error(
        file,
        { line: index + 1, column: key[1].length + 1 },
        `${section} names ${key[2]}; the step library is used as published`,
      ),
    ];
  });
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (failure) {
    if (
      failure instanceof Error &&
      'code' in failure &&
      (failure.code === 'ENOENT' || failure.code === 'ENOTDIR')
    ) {
      return null;
    }
    throw failure;
  }
}

async function patchProblems(
  library: SentenceLibrary,
  directory: string,
  shown: (path: string) => string,
): Promise<ValidationError[]> {
  let names: readonly string[];
  try {
    names = await readdir(join(directory, 'patches'));
  } catch {
    return [];
  }
  // pnpm writes @scope__name@x.patch, patch-package @scope+name+x.patch.
  const [scope, name] = library.name.startsWith('@')
    ? library.name.slice(1).split('/')
    : ['', library.name];
  const patchName = new RegExp(
    `^${scope === '' ? '' : `@?${escape(scope)}(?:__|\\+)`}${escape(name)}[@+]`,
    'u',
  );
  return names
    .filter((candidate) => patchName.test(candidate))
    .map((candidate) =>
      error(
        shown(join(directory, 'patches', candidate)),
        { line: 1, column: 1 },
        `patches ${library.name}; the step library may not be patched`,
      ),
    );
}

/** Every patch or fork of the step library between the project directory and the repository root. */
export async function libraryCopies(
  library: SentenceLibrary,
  projectRoot: string,
  repositoryRoot: string,
): Promise<readonly ValidationError[]> {
  const shown = (path: string) => toPosix(relative(projectRoot, path)) || '.';
  const problems: ValidationError[] = [];
  for (let directory = projectRoot; ; directory = dirname(directory)) {
    const text = await readOptional(join(directory, 'package.json'));
    if (text !== null) {
      const parsed: unknown = JSON.parse(text);
      const manifest = { file: shown(join(directory, 'package.json')), directory, text };
      problems.push(
        ...(isObject(parsed) ? await manifestProblems({ library, manifest }, parsed) : []),
      );
    }
    const workspace = await readOptional(join(directory, 'pnpm-workspace.yaml'));
    if (workspace !== null) {
      problems.push(
        ...workspaceProblems(library, shown(join(directory, 'pnpm-workspace.yaml')), workspace),
      );
    }
    problems.push(...(await patchProblems(library, directory, shown)));
    if (directory === repositoryRoot || dirname(directory) === directory) {
      return problems;
    }
  }
}
