import { relative } from 'node:path';

import type { CatalogEntrySummary } from '@suites/blackbox-catalog';

import { compileFeatures, type CompiledOutput } from '../compiler/compile.js';
import { MANIFEST_FILE, type CompiledScenario } from '../compiler/manifest.js';
import type { StepLibrary } from '../runtime/library.js';
import type { GherkinProject } from './config.js';
import { acceptedFeatures, projectFiles, toPosix } from './files.js';

export interface CompileProjectInput {
  readonly project: GherkinProject;
  readonly catalog: readonly CatalogEntrySummary[];
  readonly library: StepLibrary;
  /** Module generated files import their runtime from: `@suites/blackbox-gherkin` outside tests. */
  readonly runtimeModule: string;
}

/**
 * Compiles every accepted feature of the project: the files a feature glob
 * matches. All features compile or none do.
 */
export async function compileProject(input: CompileProjectInput): Promise<CompiledOutput> {
  const { project } = input;
  const features = acceptedFeatures(await projectFiles(project.root, [project.outputDir]), project);
  return compileFeatures({
    rootDir: project.root,
    outputDir: project.outputDir,
    features,
    context: { catalog: input.catalog, sandboxProfiles: project.sandboxProfiles, library: input.library },
    runtimeModule: input.runtimeModule,
  });
}

function scenarioLine(scenario: CompiledScenario): string {
  const requirements = scenario.requirements.length === 0 ? '-' : scenario.requirements.join(', ');
  const deadlines = scenario.barrierDeadlines.map((deadline) => `${deadline.seconds}s at line ${deadline.line}`);
  const barrier = deadlines.length === 0 ? '' : ` (barrier deadlines: ${deadlines.join(', ')})`;
  return `${scenario.feature}:${scenario.line} [${requirements}] ${scenario.titlePath.slice(1).join(' › ')}${barrier}`;
}

/** What a compile wrote: one line per scenario with its requirement IDs and barrier deadlines. */
export function renderCompile(project: GherkinProject, output: CompiledOutput): string {
  const { manifest } = output;
  const where = toPosix(relative(project.root, project.outputDir));
  return [
    ...manifest.scenarios.map(scenarioLine),
    `compiled ${manifest.features.length} feature(s) into ${manifest.scenarios.length} scenario(s) in ${where}/ with ${MANIFEST_FILE}; step library ${manifest.library.name}@${manifest.library.version} ${manifest.library.vocabularyHash}`,
  ].join('\n');
}
