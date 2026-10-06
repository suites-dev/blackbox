import { resolve } from 'node:path';

import { Errors, Flags } from '@oclif/core';

import { GHERKIN_CONFIG_FILE, GherkinConfigError, loadGherkinProject, type GherkinProject } from '../project/config.js';

/** Exit codes shared by the gherkin commands: a failed check, and a project or usage error. */
export const EXIT = { failed: 1, usage: 2 } as const;

/** `--config`: the project's blackbox.feature.yaml, relative to the working directory. */
export const configFlag = Flags.string({
  description: `the project's ${GHERKIN_CONFIG_FILE}`,
  default: GHERKIN_CONFIG_FILE,
});

export function projectAt(configFile: string): GherkinProject {
  const file = resolve(process.cwd(), configFile);
  try {
    return loadGherkinProject(file);
  } catch (error) {
    if (error instanceof GherkinConfigError) {
      Errors.error(error.message, { exit: EXIT.usage });
    }
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      Errors.error(`no ${GHERKIN_CONFIG_FILE} at ${file}; pass --config <path>`, { exit: EXIT.usage });
    }
    throw error;
  }
}
