import { fileURLToPath } from 'node:url';

import type {
  BlackboxStep,
  StepArgument,
  StepFixtures,
  StepLibrary,
  StepResolution,
} from './step-types.js';

/** Where a step was written: the `.feature` file, its line and column, and its keyword. */
export interface StepSite {
  readonly feature: URL;
  readonly line: number;
  readonly column: number;
  readonly keyword: string;
}

export type StepRunner = (
  fixtures: StepFixtures,
  site: StepSite,
  text: string,
  argument: StepArgument,
) => Promise<void>;

function unresolvedMessage(resolution: Exclude<StepResolution, { status: 'resolved' }>): string {
  switch (resolution.status) {
    case 'undefined':
      return 'is not defined by the step library';
    case 'ambiguous':
      return `matches ${resolution.expressions.length} library steps`;
    case 'unavailable':
      return `needs capability "${resolution.capability}", which this Blackbox runtime does not offer`;
  }
}

/**
 * Runs one compiled step as a native Playwright step whose location is the
 * `.feature` line. The step is resolved again at run time, so a generated file
 * that is stale against the installed library fails instead of running
 * something nobody compiled.
 */
export function createStepRunner(library: StepLibrary, step: BlackboxStep): StepRunner {
  return async (fixtures, site, text, argument) => {
    const resolution = library.resolve(text);
    const file = fileURLToPath(site.feature);
    if (resolution.status !== 'resolved') {
      throw new Error(
        `${file}:${site.line}:${site.column}: step "${site.keyword} ${text}" ${unresolvedMessage(resolution)}; recompile the feature`,
      );
    }
    const { definition, parameters } = resolution;
    await step(
      `${site.keyword} ${text}`,
      () => definition.run({ fixtures, parameters, argument }),
      { location: { file, line: site.line, column: site.column }, box: true },
    );
  };
}
