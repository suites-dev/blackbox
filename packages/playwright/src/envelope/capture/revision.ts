import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { promisify } from 'node:util';

import { digestOf, digestBytes } from '../canonical.js';
import { sourceFingerprint, unavailableSource } from '../fingerprints.js';
import type { SourceSection, WorkingTree } from '../types.js';

const run = promisify(execFile);
const limits = {
  diffBytes: 64 * 1024 * 1024,
  untrackedFiles: 200,
  untrackedBytes: 4 * 1024 * 1024,
};

async function git(directory: string, args: readonly string[]): Promise<string> {
  const { stdout } = await run('git', ['-C', directory, ...args], {
    timeout: 15_000,
    maxBuffer: limits.diffBytes,
    encoding: 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
  });
  return stdout;
}

async function tryGit(directory: string, args: readonly string[]): Promise<string | null> {
  try {
    return (await git(directory, args)).trim();
  } catch {
    return null;
  }
}

async function fileDigest(path: string): Promise<string | null> {
  const handle = await open(path, 'r').catch(() => null);
  if (handle === null) {
    return null;
  }
  try {
    const { size } = await handle.stat();
    if (size > limits.untrackedBytes) {
      return null;
    }
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ start: 0, autoClose: false })) {
      hash.update(chunk as Buffer);
    }
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}

/**
 * Where Blackbox itself writes while it runs. Everything else under `.blackbox/` (the catalog, drivers,
 * clients, instrumentation) is project input and stays in the working-tree digest.
 */
const runtimeDirectories = [
  '.blackbox/tmp',
  '.blackbox/experiments',
  '.blackbox/reports',
  '.blackbox/state',
];

/** `git` reports real paths, so a symlinked output directory must be resolved before it is compared. */
async function relativeTo(top: string, path: string): Promise<string> {
  if (!isAbsolute(path)) {
    return path;
  }
  const real = await realpath(path).catch(() => path);
  return relative(top, real);
}

/** Paths the run itself writes are not part of the code under test. */
function excluded(paths: readonly string[]): string[] {
  return ['--', '.', ...paths.map((path) => `:(exclude)${path}`)];
}

async function workingTree(input: {
  readonly top: string;
  readonly ignore: readonly string[];
}): Promise<{ readonly tree: WorkingTree; readonly changed: readonly string[] }> {
  const scope = excluded(input.ignore);
  let status: string;
  try {
    // Not trimmed: the first column of a porcelain entry is significant.
    status = await git(input.top, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      ...scope,
    ]);
  } catch {
    return { tree: { state: 'unknown', reason: 'git-status-failed' }, changed: [] };
  }
  if (status === '') {
    return { tree: { state: 'clean' }, changed: [] };
  }
  const entries = status.split('\0').filter((entry) => entry.length > 0);
  const untracked = entries
    .filter((entry) => entry.startsWith('?? '))
    .map((entry) => entry.slice(3))
    .sort();
  let diff: string | null;
  try {
    diff = await git(input.top, ['diff', 'HEAD', '--binary', '--no-ext-diff', ...scope]);
  } catch {
    diff = null;
  }
  const hashed = [];
  let partial = diff === null || untracked.length > limits.untrackedFiles;
  for (const path of untracked.slice(0, limits.untrackedFiles)) {
    const digest = await fileDigest(join(input.top, path));
    partial = partial || digest === null;
    hashed.push({ path, digest });
  }
  return {
    tree: {
      state: 'dirty',
      digest: digestOf({
        diff: diff === null ? null : digestBytes(diff),
        entries: entries.map((entry) => entry.slice(0, 2)).sort(),
        untracked: hashed,
        untrackedOmitted: Math.max(0, untracked.length - limits.untrackedFiles),
      }),
      coverage: partial ? 'partial' : 'complete',
    },
    changed: entries.map((entry) => entry.slice(3)).sort(),
  };
}

export interface CapturedSource {
  readonly source: SourceSection;
  readonly branch: string | null;
  readonly changedPaths: readonly string[];
}

/**
 * The code under test as it was when the attempt began, including uncommitted edits: a commit alone would
 * label a modified working tree with its last clean state. Unavailable is a recorded state, never a guess.
 */
export async function captureSource(input: {
  readonly directory: string;
  readonly ignore: readonly string[];
}): Promise<CapturedSource> {
  const unavailable = (reason: string): CapturedSource => ({
    source: unavailableSource(reason),
    branch: null,
    changedPaths: [],
  });
  const top = await tryGit(input.directory, ['rev-parse', '--show-toplevel']);
  if (top === null || top === '') {
    return unavailable('not-a-git-repository');
  }
  const commit = await tryGit(top, ['rev-parse', 'HEAD']);
  const tree = await tryGit(top, ['rev-parse', 'HEAD^{tree}']);
  const roots = await tryGit(top, ['rev-list', '--max-parents=0', 'HEAD']);
  if (commit === null || tree === null || roots === null || roots === '') {
    return unavailable('no-commits');
  }
  const repoId = `git:${roots.split('\n').sort()[0] ?? roots}`;
  const ignore = (
    await Promise.all([...runtimeDirectories, ...input.ignore].map((path) => relativeTo(top, path)))
  ).filter((path) => path !== '' && !path.startsWith('..'));
  const { tree: workTree, changed } = await workingTree({ top, ignore });
  const identity = { repoId, commit, tree, workingTree: workTree };
  const branch = await tryGit(top, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return {
    source: {
      state: 'captured',
      ...identity,
      fingerprint: sourceFingerprint(identity),
      reason: workTree.state === 'unknown' ? workTree.reason : null,
    },
    branch,
    changedPaths: changed.slice(0, 50),
  };
}
