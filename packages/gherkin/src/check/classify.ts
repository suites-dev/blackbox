import { matchesAny } from '../project/files.js';

// The spec/code classifier of hard rule 2, the same rules as the repository's
// scripts/check-spec-separation.mjs, with the classes taken from the project's
// blackbox.feature.yaml. Deny by default: a path is spec when a spec glob
// matches it, neutral when a neutral glob does, and code otherwise. Package
// manifests and lockfiles are read by content: an entry naming the step
// library is spec, any other changed entry is code.

export interface ChangeClasses {
  /** Repository-relative globs. */
  readonly spec: readonly string[];
  readonly neutral: readonly string[];
  /** Packages whose dependency entries are step definitions. */
  readonly libraries: readonly string[];
}

/** One changed path with its contents before and after (null when absent; read only for manifests). */
export interface Change {
  readonly path: string;
  readonly before: string | null;
  readonly after: string | null;
}

export interface ClassifiedPath {
  readonly path: string;
  /** For a manifest, the first entry that put it in this class. */
  readonly reason: string | null;
}

export interface Classification {
  readonly spec: readonly ClassifiedPath[];
  readonly code: readonly ClassifiedPath[];
  readonly neutral: readonly ClassifiedPath[];
}

export const MANIFEST = /(?:^|\/)(?:package\.json|package-lock\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|yarn\.lock)$/u;

interface Entry {
  readonly path: readonly string[];
  readonly value: string;
}

function namesLibrary(key: string, libraries: readonly string[]): boolean {
  return libraries.some((name) =>
    new RegExp(`(?:^|[\\s>/('"])${name.replace(/[$()*+.?[\\\]^{|}]/gu, '\\$&')}(?=$|[@\\s()'":])`, 'u').test(key),
  );
}

/** Flattens JSON into key paths; array scalars become keys so they are matched too. */
function jsonEntries(value: unknown, path: readonly string[] = [], entries: Entry[] = []): Entry[] {
  if (typeof value !== 'object' || value === null) {
    entries.push({ path, value: JSON.stringify(value) });
    return entries;
  }
  const children: readonly (readonly [string | null, unknown])[] = Array.isArray(value)
    ? value.map((child: unknown) => [null, child] as const)
    : Object.entries(value);
  if (children.length === 0) {
    entries.push({ path, value: JSON.stringify(value) });
  }
  for (const [key, child] of children) {
    if (key === null && (child === null || typeof child !== 'object')) {
      entries.push({ path: [...path, JSON.stringify(child)], value: '' });
    } else {
      jsonEntries(child, [...path, key ?? '[]'], entries);
    }
  }
  return entries;
}

const YAML_KEY = /^('(?:[^']|'')*'|"(?:[^"\\]|\\.)*"|[^\s#'"][^:#]*?)\s*:(?:\s+(.*))?$/u;

/**
 * One entry per meaningful line of a YAML lockfile, keyed by the chain of keys
 * above it. Not a YAML parser: it only attributes every changed line to the
 * keys that enclose it, and every non-comment line yields an entry.
 */
function yamlEntries(text: string): Entry[] {
  const entries: Entry[] = [];
  const stack: { readonly indent: number; readonly key: string }[] = [];
  for (const line of text.split(/\r?\n/u)) {
    const content = line.trim();
    if (content === '' || content === '---' || content.startsWith('#')) {
      continue;
    }
    const indent = line.length - line.trimStart().length;
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    // A list item, or a line that is not `key: value`, is its own key.
    const [, key = content, value = ''] = (content.startsWith('-') ? null : YAML_KEY.exec(content)) ?? [];
    entries.push({ path: [...stack.map((frame) => frame.key), key], value });
    stack.push({ indent, key });
  }
  return entries;
}

function manifestEntries(path: string, text: string | null): Entry[] {
  if (text === null) {
    return [];
  }
  return path.endsWith('.json') ? jsonEntries(JSON.parse(text)) : yamlEntries(text);
}

/** Entries present on one side only, counted as multisets. */
function changedEntries(before: readonly Entry[], after: readonly Entry[]): Entry[] {
  const identity = (entry: Entry) => JSON.stringify([...entry.path, entry.value]);
  const remaining = new Map<string, number>();
  for (const entry of before) {
    remaining.set(identity(entry), (remaining.get(identity(entry)) ?? 0) + 1);
  }
  const changed: Entry[] = [];
  for (const entry of after) {
    const count = remaining.get(identity(entry)) ?? 0;
    if (count > 0) {
      remaining.set(identity(entry), count - 1);
    } else {
      changed.push(entry);
    }
  }
  for (const entry of before) {
    const count = remaining.get(identity(entry)) ?? 0;
    if (count > 0) {
      remaining.set(identity(entry), count - 1);
      changed.push(entry);
    }
  }
  return changed;
}

function classifyManifest(change: Change, classes: ChangeClasses): { spec: string[]; code: string[] } {
  const sides = { spec: [] as string[], code: [] as string[] };
  const changed = changedEntries(manifestEntries(change.path, change.before), manifestEntries(change.path, change.after));
  for (const entry of changed) {
    const side = entry.path.some((key) => namesLibrary(key, classes.libraries)) ? 'spec' : 'code';
    const reason = entry.path.join(' > ');
    if (!sides[side].includes(reason)) {
      sides[side].push(reason);
    }
  }
  if (changed.length === 0) {
    sides.code.push('formatting or comments');
  }
  return sides;
}

export function classifyChanges(changes: readonly Change[], classes: ChangeClasses): Classification {
  const result = { spec: [] as ClassifiedPath[], code: [] as ClassifiedPath[], neutral: [] as ClassifiedPath[] };
  for (const change of changes) {
    if (matchesAny(change.path, classes.spec)) {
      result.spec.push({ path: change.path, reason: null });
    } else if (matchesAny(change.path, classes.neutral)) {
      result.neutral.push({ path: change.path, reason: null });
    } else if (MANIFEST.test(change.path)) {
      const sides = classifyManifest(change, classes);
      for (const side of ['spec', 'code'] as const) {
        if (sides[side].length > 0) {
          result[side].push({ path: change.path, reason: sides[side][0] });
        }
      }
    } else {
      result.code.push({ path: change.path, reason: null });
    }
  }
  return result;
}

/** A change may contain spec paths or code paths, not both. */
export function separationProblem(result: Classification): string | null {
  if (result.spec.length === 0 || result.code.length === 0) {
    return null;
  }
  const names = (entries: readonly ClassifiedPath[]) => [...new Set(entries.map((entry) => entry.path))].join(', ');
  return `this change mixes spec and code. Split it into a spec-only change and a code-only change. Spec: ${names(result.spec)}. Code: ${names(result.code)}.`;
}
