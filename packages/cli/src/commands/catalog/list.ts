import { Flags } from '@oclif/core';

import { SystemsCommand } from '../../operations/viewing/systems-command.js';

/** Hidden alias: `catalog list` → `systems`. */
export default class CatalogList extends SystemsCommand {
  static override hidden = true;
  static override description = 'List catalog systems as text or JSON.';
  static override flags = { json: Flags.boolean({ default: false }) };

  protected async execute(): Promise<void> {
    const { flags } = await this.parseInput(() => this.parse(CatalogList));
    await this.executeSystems({ json: flags.json });
  }
}
