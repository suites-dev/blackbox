import { Command, Flags } from '@oclif/core';
import { runCatalogValidate } from '@suites/blackbox-catalog';
import { renderCatalogOutput } from '../../catalog/catalog-output.js';
import { EXIT_CODES } from '../../cli/exit-codes.js';

export default class CatalogValidate extends Command {
  static override description = 'Validate the catalog and Compose inputs.';
  static override flags = { json: Flags.boolean({ default: false }) };
  public async run(): Promise<void> {
    const { flags } = await this.parse(CatalogValidate);
    const output = renderCatalogOutput({
      mode: flags.json ? 'json' : 'human',
      result: await runCatalogValidate({ projectDirectory: process.cwd() }),
    });
    if (output.failed) {
      this.error(output.text, { exit: EXIT_CODES.unchangedCommandFailure });
    }
    this.log(output.text);
  }
}
