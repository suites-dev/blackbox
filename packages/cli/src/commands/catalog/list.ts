import { Command, Flags } from '@oclif/core';
import { runCatalogList } from '@suites/blackbox-catalog-internal';
import { renderCatalogOutput } from '../../catalog/catalog-output.js';

export default class CatalogList extends Command {
  static override description = 'List catalog systems as text or JSON.';
  static override flags = { json: Flags.boolean({ default: false }) };
  public async run(): Promise<void> {
    const { flags } = await this.parse(CatalogList);
    const output = renderCatalogOutput({
      mode: flags.json ? 'json' : 'human',
      result: await runCatalogList({ projectDirectory: process.cwd() }),
    });
    if (output.failed) {
      this.error(output.text, { exit: 1 });
    }
    this.log(output.text);
  }
}
