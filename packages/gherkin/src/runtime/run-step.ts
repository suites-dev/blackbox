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
 * Puts the `.feature` position first in a failing step's stack. Playwright reads
 * an error's location and code frame from its first stack frame, so the failure
 * is reported at the `.feature` line instead of the generated call site. The
 * frame is anonymous because Playwright's stack parser rejects a function name
 * that contains a slash, which step text often does.
 */
function atFeatureSite(error: unknown, file: string, site: StepSite): unknown {
  if (!(error instanceof Error) || error.stack === undefined) {
    return error;
  }
  const frame = `    at ${file}:${site.line}:${site.column}`;
  const lines = error.stack.split('\n');
  const firstFrame = lines.findIndex((line) => /^\s+at /u.test(line));
  lines.splice(firstFrame === -1 ? lines.length : firstFrame, 0, frame);
  error.stack = lines.join('\n');
  return error;
}

/**
 * Runs one compiled step as a native Playwright step whose location is the
 * `.feature` line, and reports a failure there too. The step is not boxed:
 * Playwright replaces a boxed step's error stack with the generated call site.
 * The step is resolved again at run time, so a generated file that is stale
 * against the installed library fails instead of running something nobody
 * compiled.
 */
export function createStepRunner(library: StepLibrary, step: BlackboxStep): StepRunner {
  return async (fixtures, site, text, argument) => {
    const resolution = library.resolve(text);
    const file = fileURLToPath(site.feature);
    if (resolution.status !== 'resolved') {
      throw atFeatureSite(
        new Error(
          `${file}:${site.line}:${site.column}: step "${site.keyword} ${text}" ${unresolvedMessage(resolution)}; recompile the feature`,
        ),
        file,
        site,
      );
    }
    const { definition, parameters } = resolution;
    await step(
      `${site.keyword} ${text}`,
      async () => {
        try {
          await definition.run({ fixtures, parameters, argument });
        } catch (error) {
          throw atFeatureSite(error, file, site);
        }
      },
      { location: { file, line: site.line, column: site.column } },
    );
  };
}
