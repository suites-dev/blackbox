import { Flags } from '@oclif/core';

import { LsCommand } from '../operations/inspection/ls-command.js';

/** Hidden alias: `history` → `ls --all`. */
export default class History extends LsCommand {
  static override hidden = true;
  static override description = 'List exact execution and Capsule records.';
  static override flags = { json: Flags.boolean({ default: false }) };

  protected async execute(): Promise<void> {
    const { flags } = await this.parseInput(() => this.parse(History));
    await this.executeLs({ all: true, json: flags.json });
  }
}
