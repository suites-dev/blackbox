import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { CatalogEntrySummary } from '@suites/blackbox-catalog';

import { sortErrors, type ValidationError } from '../feature/diagnostics.js';
import type { GherkinProject } from '../project/config.js';
import { acceptedFeatures, projectFiles } from '../project/files.js';
import { sentenceMatcher } from '../sentences/match.js';
import type { SentenceList } from '../sentences/model.js';
import { validateFeature } from './feature.js';

/**
 * Validates every accepted feature of a project against a sentence list and
 * the catalog. Returns every error with its `file:line:column`, empty when
 * the project is valid. It writes nothing.
 */
export async function validate(
  project: GherkinProject,
  sentences: SentenceList,
  catalog: readonly CatalogEntrySummary[],
): Promise<readonly ValidationError[]> {
  const features = acceptedFeatures(await projectFiles(project.root), project);
  const context = {
    catalog,
    sandboxProfiles: Object.keys(project.sandboxProfiles),
    match: sentenceMatcher(sentences),
    capabilities: new Set(sentences.capabilities),
  };
  const errors: ValidationError[] = [];
  for (const file of features) {
    errors.push(
      ...validateFeature(await readFile(join(project.root, file), 'utf8'), file, context),
    );
  }
  return sortErrors(errors);
}
