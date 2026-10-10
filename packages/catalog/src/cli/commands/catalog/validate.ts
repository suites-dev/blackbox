import { Command, Flags } from '@oclif/core';
import { readRuntimeActivationAdapters } from '@suites/blackbox-cli-contract';
import { isCatalogActivationAdapter, runCatalogValidate } from '@suites/blackbox-catalog';
import { renderCatalogOutput } from '../../catalog-output.js';

export default class CatalogValidate extends Command {
  static override description = 'Validate the catalog and Compose inputs.';
  static override flags = { json: Flags.boolean({ default: false }) };
  public async run(): Promise<void> {
    const { flags } = await this.parse(CatalogValidate);
    const output = renderCatalogOutput({
      mode: flags.json ? 'json' : 'human',
      result: await runCatalogValidate({
        projectDirectory: process.cwd(),
        activationAdapters: readRuntimeActivationAdapters(isCatalogActivationAdapter),
      }),
    });
    if (output.failed) {
      this.error(output.text, { exit: 1 });
    }
    this.log(output.text);
  }
}
