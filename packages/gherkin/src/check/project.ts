import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import type { GherkinProject } from '../project/config.js';
import { projectFiles, toPosix } from '../project/files.js';
import { git, gitTopLevel } from './git.js';
import { packageProblems } from './packages.js';

// `blackbox feature check`: static checks for hard rule 3 (step definitions
// come only from the shared library) and for generated output that must never
// be committed. It detects the known mechanisms; it cannot prove that no other
// test code exists, and it does not replace the run-time checks of `verify`.

const STEP_FILE = /(?:^|\/)(?:[^/]*\.steps\.[^/]+|step_definitions\/.*)$/u;
const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/u;
// import … from 'x', import 'x', export … from 'x', import('x'), require('x').
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"`])([^'"`\n]+)\1/gu;

/** Why importing a specifier registers or runs steps outside the shared library, or null when it does not. */
function forbiddenImport(specifier: string): string | null {
  if (specifier === 'playwright-bdd' || specifier.startsWith('playwright-bdd/')) {
    return 'playwright-bdd defines its own steps';
  }
  if (specifier === '@cucumber/cucumber' || specifier.startsWith('@cucumber/cucumber/')) {
    return 'Cucumber step definitions are not the shared library';
  }
  if (specifier === '@suites/blackbox-gherkin' || (specifier.startsWith('@suites/blackbox-gherkin/') && specifier !== '@suites/blackbox-gherkin/config')) {
    return 'only generated tests import the Gherkin runtime; projects use @suites/blackbox-gherkin/config';
  }
  return null;
}

async function importProblems(root: string, files: readonly string[]): Promise<string[]> {
  const problems: string[] = [];
  for (const file of files.filter((candidate) => SOURCE_FILE.test(candidate))) {
    const text = await readFile(join(root, file), 'utf8');
    for (const [, , specifier] of text.matchAll(SPECIFIER)) {
      const why = forbiddenImport(specifier);
      if (why !== null) {
        problems.push(`${file}: imports ${JSON.stringify(specifier)}; ${why}`);
      }
    }
  }
  return problems;
}

async function trackedOutputProblems(project: GherkinProject): Promise<string[]> {
  const output = toPosix(relative(project.root, project.outputDir));
  let tracked: string;
  try {
    tracked = await git(['ls-files', '-z', '--', output], project.root);
  } catch (error) {
    return [`cannot confirm that ${output}/ is not tracked by git: ${(error as Error).message.trim()}`];
  }
  const files = tracked.split('\0').filter((file) => file !== '');
  return files.length === 0 ? [] : [`${output}/ holds generated tests and must not be tracked by git; tracked: ${files.join(', ')}`];
}

/** Every rule-3 and generated-output problem in the project, or none. */
export async function checkProject(project: GherkinProject): Promise<readonly string[]> {
  const files = await projectFiles(project.root, [project.outputDir]);
  let repositoryRoot = project.root;
  try {
    repositoryRoot = await gitTopLevel(project.root);
  } catch {
    // Reported by the tracked-output check; package manifests are read in the project only.
  }
  return [
    ...(await trackedOutputProblems(project)),
    ...files
      .filter((file) => STEP_FILE.test(file))
      .map((file) => `${file}: a project step file; steps come only from the shared Blackbox step library`),
    ...(await importProblems(project.root, files)),
    ...(await packageProblems(project.root, repositoryRoot)),
  ];
}
