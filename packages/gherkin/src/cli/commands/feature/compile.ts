import { Command } from '@oclif/core';

import { loadCatalogEntries } from '../../../compiler/compile.js';
import { FeatureCompileError } from '../../../compiler/planning/diagnostics.js';
import { library } from '../../../library/index.js';
import { compileProject, renderCompile } from '../../../project/compile.js';
import { configFlag, EXIT, projectAt } from '../../project.js';

export default class FeatureCompile extends Command {
  static override description =
    'Compile the accepted .feature files into generated Playwright tests and a compile manifest.';

  static override flags = { config: configFlag };

  public async run(): Promise<void> {
    const { flags } = await this.parse(FeatureCompile);
    const project = projectAt(flags.config);
    try {
      const output = await compileProject({
        project,
        catalog: await loadCatalogEntries(project.blackboxConfigFile),
        library,
        runtimeModule: '@suites/blackbox-gherkin',
      });
      this.log(renderCompile(project, output));
    } catch (error) {
      if (!(error instanceof FeatureCompileError)) {
        throw error;
      }
      this.logToStderr(`${error.message}\ncompile: failed; nothing was generated`);
      this.exit(EXIT.failed);
    }
  }
}
