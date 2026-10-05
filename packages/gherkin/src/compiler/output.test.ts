import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { compileFeatures, type CompileFeaturesInput } from './compile.js';
import { FeatureCompileError } from './planning/diagnostics.js';
import { testContext } from './testing/context.js';
import { cleanupProjects, fixtureProject, type FixtureProject } from './testing/project.js';

// Requirements: generated output is git-ignored; a compile writes every
// feature or none, so a partial or stale set of generated tests never runs in
// place of the full one (hard rule 5: selection changes are never silent).

afterEach(cleanupProjects);

function input(project: FixtureProject, features: readonly string[] = project.features): CompileFeaturesInput {
  return {
    rootDir: project.root,
    outputDir: project.outputDir,
    features,
    context: testContext(),
    runtimeModule: '@suites/blackbox-gherkin',
  };
}

async function listOutput(project: FixtureProject): Promise<readonly string[]> {
  return (await readdir(project.outputDir, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(project.outputDir.length + 1))
    .sort();
}

describe('compile output', () => {
  it('ignores the whole output directory in git', async () => {
    const project = await fixtureProject();
    await compileFeatures(input(project));
    expect(await readFile(join(project.outputDir, '.gitignore'), 'utf8')).toBe(
      '# Written by @suites/blackbox-gherkin: generated tests are never committed.\n*\n',
    );
  });

  it('writes nothing and removes the previous output when any feature fails', async () => {
    const project = await fixtureProject();
    await compileFeatures(input(project));
    await writeFile(join(project.root, 'features/broken.feature'), '@system:subscription-system @sandbox:default @only\nFeature: broken\n\n  Scenario: s\n    When the agent invents a step\n');
    const failure = await compileFeatures(input(project, [...project.features, 'features/broken.feature'])).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(FeatureCompileError);
    expect((failure as FeatureCompileError).message.split('\n')).toEqual([
      'features/broken.feature:1:46: tag "@only" is not allowed; only @system:<id>, @sandbox:<profile> and @requirement:REQ-<n> are accepted',
      'features/broken.feature:5:5: undefined step "When the agent invents a step"; only steps from the shared Blackbox step library are allowed',
    ]);
    expect(await listOutput(project)).toEqual(['.gitignore']);
  });

  it('removes the generated test of a feature that is no longer compiled', async () => {
    const project = await fixtureProject();
    await compileFeatures(input(project));
    await compileFeatures(input(project, ['features/subsystem.feature']));
    expect(await listOutput(project)).toEqual(['.gitignore', 'compile-manifest.json', 'features/subsystem.feature.spec.mjs']);
  });

  it('removes stale output when a feature cannot be read, and recompiles after a failure', async () => {
    const project = await fixtureProject();
    await compileFeatures(input(project));
    await expect(compileFeatures(input(project, ['features/missing.feature']))).rejects.toThrow('ENOENT');
    expect(await listOutput(project)).toEqual(['.gitignore']);
    await compileFeatures(input(project, ['features/subsystem.feature']));
    expect(await listOutput(project)).toEqual(['.gitignore', 'compile-manifest.json', 'features/subsystem.feature.spec.mjs']);
  });

  it('refuses to write into a non-empty directory it did not create, and leaves it untouched', async () => {
    const project = await fixtureProject();
    await mkdir(project.outputDir);
    await writeFile(join(project.outputDir, 'notes.txt'), 'keep me');
    await expect(compileFeatures(input(project))).rejects.toThrow(
      `${project.outputDir} is not empty and was not written by @suites/blackbox-gherkin; refusing to replace its contents`,
    );
    expect(await listOutput(project)).toEqual(['notes.txt']);
  });

  it('rejects a feature outside the compile root and an empty feature list', async () => {
    const project = await fixtureProject();
    await expect(compileFeatures(input(project, ['../elsewhere.feature']))).rejects.toThrow(
      `Feature ../elsewhere.feature is outside the compile root ${project.root}`,
    );
    await expect(compileFeatures(input(project, []))).rejects.toThrow('No feature files to compile');
  });
});
