import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import type { CatalogEntrySummary } from '@suites/blackbox-catalog';

import { sortErrors, type ValidationError } from '../feature/diagnostics.js';
import { gitTopLevel } from '../policy/git.js';
import { libraryCopies } from '../policy/library-copies.js';
import { runnerImports } from '../policy/runners.js';
import type { GherkinProject } from '../project/config.js';
import { acceptedFeatures, projectFiles } from '../project/files.js';
import { sentenceMatcher } from '../sentences/match.js';
import type { SentenceList } from '../sentences/model.js';
import { validateFeature } from './feature.js';

/** Where the package-manifest rule stops: the repository root, or the project directory outside git. */
async function repositoryRoot(projectRoot: string): Promise<string> {
  try {
    return await gitTopLevel(projectRoot);
  } catch {
    return projectRoot;
  }
}

/**
 * Validates every accepted feature of a project against a sentence list and
 * the catalog, and checks that the project runs features only through that
 * sentence list's library: no Gherkin runner imports, and no patched or
 * forked copy of the library. Returns every error with its
 * `file:line:column`, empty when the project is valid. It writes nothing.
 */
export async function validate(
  project: GherkinProject,
  sentences: SentenceList,
  catalog: readonly CatalogEntrySummary[],
): Promise<readonly ValidationError[]> {
  const files = await projectFiles(project.root);
  const features = acceptedFeatures(files, project);
  const context = {
    catalog,
    sandboxProfiles: Object.keys(project.sandboxProfiles),
    match: sentenceMatcher(sentences),
    capabilities: new Set(sentences.capabilities),
  };
  const errors: ValidationError[] = [];
  if (features.length === 0) {
    errors.push({
      code: 'no-features',
      file: basename(project.configFile),
      line: 1,
      column: 1,
      message: `no feature file matches ${project.features.join(', ')}`,
    });
  }
  for (const file of features) {
    errors.push(
      ...validateFeature(await readFile(join(project.root, file), 'utf8'), file, context),
    );
  }
  errors.push(...(await runnerImports(project.root, files)));
  errors.push(
    ...(await libraryCopies(sentences.library, project.root, await repositoryRoot(project.root))),
  );
  return sortErrors(errors);
}
