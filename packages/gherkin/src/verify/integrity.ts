import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { sha256, type CompileManifest } from '../compiler/manifest.js';
import type { GherkinProject } from '../project/config.js';
import { acceptedFeatures, projectFiles } from '../project/files.js';
import type { StepLibrary } from '../runtime/library.js';

// What the run executed must be what was compiled from the accepted features
// with the installed step library: verify recomputes every hash the compile
// manifest recorded and compares the library identity.

async function hashOf(file: string): Promise<string | null> {
  try {
    return sha256(await readFile(file, 'utf8'));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/** The accepted features on disk must be exactly the compiled ones. */
async function featureSetProblems(project: GherkinProject, manifest: CompileManifest): Promise<string[]> {
  const accepted = acceptedFeatures(await projectFiles(project.root, [project.outputDir]), project);
  const compiled = manifest.features.map((feature) => feature.feature);
  return [
    ...accepted
      .filter((feature) => !compiled.includes(feature))
      .map((feature) => `feature ${feature} is not in the compile manifest; recompile`),
    ...compiled
      .filter((feature) => !accepted.includes(feature))
      .map((feature) => `compiled feature ${feature} is no longer an accepted feature; recompile`),
  ];
}

async function hashProblems(project: GherkinProject, manifest: CompileManifest): Promise<string[]> {
  const problems: string[] = [];
  for (const feature of manifest.features) {
    const featureHash = await hashOf(resolve(project.root, feature.feature));
    if (featureHash !== feature.featureHash) {
      problems.push(
        `feature ${feature.feature} differs from the compiled one (compiled ${feature.featureHash}, now ${featureHash ?? 'missing'})`,
      );
    }
    const generatedHash = await hashOf(resolve(project.outputDir, feature.generated));
    if (generatedHash !== feature.generatedHash) {
      problems.push(
        `generated test ${feature.generated} differs from what compile wrote (compiled ${feature.generatedHash}, now ${generatedHash ?? 'missing'})`,
      );
    }
  }
  return problems;
}

function libraryProblems(manifest: CompileManifest, library: StepLibrary): string[] {
  const compiled = manifest.library;
  const installed = library.identity;
  const problems: string[] = [];
  if (
    compiled.name !== installed.name ||
    compiled.version !== installed.version ||
    compiled.vocabularyHash !== installed.vocabularyHash
  ) {
    problems.push(
      `the step library differs from the one the features were compiled against (compiled ${compiled.name}@${compiled.version} ${compiled.vocabularyHash}, installed ${installed.name}@${installed.version} ${installed.vocabularyHash})`,
    );
  }
  const offered = [...library.capabilities].sort().join(', ');
  const recorded = [...manifest.capabilities].sort().join(', ');
  if (offered !== recorded) {
    problems.push(`runtime capabilities differ from the compiled ones (compiled [${recorded}], installed [${offered}])`);
  }
  return problems;
}

/** Problems with the compiled output itself: feature set, feature and generated hashes, step library. */
export async function integrityProblems(
  project: GherkinProject,
  manifest: CompileManifest,
  library: StepLibrary,
): Promise<readonly string[]> {
  return [
    ...(await featureSetProblems(project, manifest)),
    ...(await hashProblems(project, manifest)),
    ...libraryProblems(manifest, library),
  ];
}
