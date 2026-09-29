import { Flags } from '@oclif/core';

import { SystemsCommand } from '../../operations/viewing/systems-command.js';

export default class CatalogLs extends SystemsCommand {
  static override summary = 'List the catalog systems that capsule up can start.';
  static override flags = { json: Flags.boolean({ default: false }) };

  protected async execute(): Promise<void> {
    const { flags } = await this.parseInput(() => this.parse(CatalogLs));
    await this.executeSystems({ json: flags.json });
  }
}
