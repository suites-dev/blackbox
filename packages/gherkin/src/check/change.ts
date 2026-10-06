import { posix, relative } from 'node:path';

import type { GherkinProject } from '../project/config.js';
import { toPosix } from '../project/files.js';
import { classifyChanges, MANIFEST, separationProblem, type Change, type ChangeClasses, type Classification } from './classify.js';
import { git, gitTopLevel } from './git.js';

// `blackbox gherkin check-change --base <ref>`: hard rule 2 for a project. A
// change may alter the accepted expectations (spec) or the code they judge,
// never both. Spec is the project's features and drafts, blackbox.gherkin.json,
// extra `changes.spec` globs, and the step-library dependency entries and
// patches.

export interface ChangeCheck {
  readonly mergeBase: string;
  readonly classification: Classification;
  /** Null when the change is spec-only, code-only or neutral. */
  readonly problem: string | null;
}

const STEP_LIBRARY = '@suites/blackbox-gherkin';

/** The project's classes as repository-relative globs. */
export function projectClasses(project: GherkinProject, repositoryRoot: string): ChangeClasses {
  const prefix = toPosix(relative(repositoryRoot, project.root));
  const inRepository = (path: string) => (prefix === '' ? path : posix.join(prefix, path));
  const file = (path: string) => toPosix(relative(repositoryRoot, path));
  return {
    spec: [
      ...[...project.features, ...project.drafts, ...project.changes.spec].map(inRepository),
      file(project.configFile),
      // pnpm and patch-package patches of the step library.
      '**/patches/@suites__blackbox-gherkin@*.patch',
      '**/patches/@suites+blackbox-gherkin+*.patch',
    ],
    neutral: project.changes.neutral.map(inRepository),
    libraries: [STEP_LIBRARY],
  };
}

async function contentAt(revision: string, path: string, cwd: string): Promise<string | null> {
  return MANIFEST.test(path) ? git(['cat-file', 'blob', `${revision}:${path}`], cwd) : null;
}

/** The changed paths between the merge base of `base` and `head`; a rename counts as both paths. */
async function readChanges(input: { readonly base: string; readonly head: string; readonly cwd: string }) {
  const { cwd } = input;
  const mergeBase = (await git(['merge-base', input.base, input.head], cwd)).trim();
  const fields = (await git(['diff', '--name-status', '-z', '--no-renames', '--no-ext-diff', mergeBase, input.head, '--'], cwd)).split('\0');
  const changes: Change[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const [status, path] = [fields[index], fields[index + 1]];
    changes.push({
      path,
      before: status === 'A' ? null : await contentAt(mergeBase, path, cwd),
      after: status === 'D' ? null : await contentAt(input.head, path, cwd),
    });
  }
  return { mergeBase, changes };
}

export async function checkChange(project: GherkinProject, refs: { readonly base: string; readonly head: string }): Promise<ChangeCheck> {
  const repositoryRoot = await gitTopLevel(project.root);
  const { mergeBase, changes } = await readChanges({ ...refs, cwd: repositoryRoot });
  const classification = classifyChanges(changes, projectClasses(project, repositoryRoot));
  return { mergeBase, classification, problem: separationProblem(classification) };
}

export function renderChangeCheck(check: ChangeCheck): string {
  const { classification: result } = check;
  const lines = [
    `check-change: merge base ${check.mergeBase.slice(0, 12)}; spec ${result.spec.length}, code ${result.code.length}, neutral ${result.neutral.length} changed paths`,
  ];
  for (const side of ['spec', 'code', 'neutral'] as const) {
    for (const entry of result[side]) {
      lines.push(`  ${side.padEnd(7)} ${entry.reason === null ? entry.path : `${entry.path} (${entry.reason})`}`);
    }
  }
  if (check.problem !== null) {
    lines.push(`error: ${check.problem}`);
  }
  return lines.join('\n');
}
