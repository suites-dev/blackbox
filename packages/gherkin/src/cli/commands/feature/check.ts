import { relative } from 'node:path';

import { Command } from '@oclif/core';

import { checkProject } from '../../../check/project.js';
import { configFlag, EXIT, projectAt } from '../../project.js';

export default class FeatureCheck extends Command {
  static override description =
    'Check the project for step definitions outside the shared library, patched or forked library packages, and tracked generated tests.';

  static override flags = { config: configFlag };

  public async run(): Promise<void> {
    const { flags } = await this.parse(FeatureCheck);
    const project = projectAt(flags.config);
    const problems = await checkProject(project);
    if (problems.length > 0) {
      this.log([...problems.map((problem) => `error: ${problem}`), `check: failed; ${problems.length} problem(s)`].join('\n'));
      this.exit(EXIT.failed);
    }
    this.log(
      `check: passed; no project step files or step-registration imports, no patched or forked step library, ${relative(project.root, project.outputDir)}/ not tracked`,
    );
  }
}
