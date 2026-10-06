import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import { listCatalogEntries, loadCatalogFile, type CatalogEntrySummary } from '@suites/blackbox-catalog';

import { emitFeature } from './emit.js';
import {
  COMPILER_NAME,
  scenarioRecords,
  sha256,
  type CompiledFeature,
  type CompiledScenario,
  type CompileManifest,
} from './manifest.js';
import { replaceOutput, type NextOutput } from './output.js';
import { FeatureCompileError, type Diagnostic } from './planning/diagnostics.js';
import type { CompileContext } from './planning/model.js';
import { planFeature } from './planning/plan.js';

export interface CompileFeaturesInput {
  /** Feature and manifest paths are recorded relative to this directory. */
  readonly rootDir: string;
  /** Git-ignored directory that receives the generated tests and the manifest. */
  readonly outputDir: string;
  readonly features: readonly string[];
  readonly context: CompileContext;
  /** Module generated files import their runtime from. */
  readonly runtimeModule: string;
}

export interface CompiledOutput {
  readonly manifest: CompileManifest;
  /** Generated test files, relative to the output directory. */
  readonly files: readonly string[];
}

const toPosix = (path: string): string => path.split(sep).join('/');

function relativeFeature(rootDir: string, feature: string): string {
  const path = relative(rootDir, resolve(rootDir, feature));
  if (path === '' || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error(`Feature ${feature} is outside the compile root ${rootDir}`);
  }
  return toPosix(path);
}

interface CompiledFile {
  readonly path: string;
  readonly code: string;
  readonly feature: CompiledFeature;
  readonly scenarios: readonly CompiledScenario[];
}

async function compileOne(input: CompileFeaturesInput, file: string): Promise<CompiledFile> {
  const absolute = resolve(input.rootDir, file);
  const source = await readFile(absolute, 'utf8');
  const plan = planFeature(source, file, input.context);
  const path = `${file}.spec.mjs`;
  const outputFile = resolve(input.outputDir, path);
  let featureFromOutput = toPosix(relative(dirname(outputFile), absolute));
  if (!featureFromOutput.startsWith('.')) {
    featureFromOutput = `./${featureFromOutput}`;
  }
  const featureHash = sha256(source);
  const code = emitFeature({
    plan,
    featureFromOutput,
    runtimeModule: input.runtimeModule,
    featureHash,
    vocabularyHash: input.context.library.identity.vocabularyHash,
  });
  return {
    path,
    code,
    feature: {
      feature: file,
      featureHash,
      title: plan.title,
      description: plan.description,
      selection: plan.selection,
      generated: path,
      generatedHash: sha256(code),
    },
    scenarios: scenarioRecords(plan, path),
  };
}

async function compileAll(input: CompileFeaturesInput, files: readonly string[]): Promise<NextOutput> {
  const compiled: CompiledFile[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const file of files) {
    try {
      compiled.push(await compileOne(input, file));
    } catch (error) {
      if (!(error instanceof FeatureCompileError)) {
        throw error;
      }
      diagnostics.push(...error.diagnostics);
    }
  }
  if (diagnostics.length > 0) {
    throw new FeatureCompileError(diagnostics);
  }
  const manifest = {
    schemaVersion: 1,
    compiler: COMPILER_NAME,
    library: input.context.library.identity,
    capabilities: input.context.library.capabilities,
    features: compiled.map((file) => file.feature),
    scenarios: compiled.flatMap((file) => file.scenarios),
  } satisfies CompileManifest;
  return { manifest, files: compiled };
}

/**
 * Compiles every feature or none. When anything fails the previous output is
 * removed and nothing new is written, so a partial or stale set of generated
 * tests can never be run in place of the full one.
 */
export async function compileFeatures(input: CompileFeaturesInput): Promise<CompiledOutput> {
  const files = [...new Set(input.features.map((feature) => relativeFeature(input.rootDir, feature)))].sort();
  if (files.length === 0) {
    throw new Error('No feature files to compile');
  }
  let next: NextOutput | null = null;
  try {
    next = await compileAll(input, files);
  } finally {
    await replaceOutput(input.outputDir, next);
  }
  return { manifest: next.manifest, files: next.files.map((file) => file.path) };
}

/** The catalog entries a feature may select, read from the project's blackbox.config.yaml. */
export async function loadCatalogEntries(configFile: string): Promise<readonly CatalogEntrySummary[]> {
  const loaded = await loadCatalogFile({ configFile });
  return listCatalogEntries({ config: loaded.config });
}
