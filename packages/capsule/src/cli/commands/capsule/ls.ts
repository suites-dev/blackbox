import { Flags } from '@oclif/core';

import { LsCommand } from '../../operations/inspection/ls-command.js';

export default class Ls extends LsCommand {
  static override summary = 'List capsules (running by default); * marks the current capsule.';
  static override flags = {
    all: Flags.boolean({ default: false, description: 'List every retained capsule' }),
    json: Flags.boolean({ default: false }),
  };

  protected async execute(): Promise<void> {
    const { flags } = await this.parseInput(() => this.parse(Ls));
    await this.executeLs({ all: flags.all, json: flags.json });
  }
}
