import { Args, Flags } from '@oclif/core';

import { DownCommand } from '../../operations/lifecycle/down-command.js';

export default class Down extends DownCommand {
  static override summary = 'Stop a capsule and keep its evidence.';
  static override args = {
    capsule: Args.string({ description: 'Capsule ID (defaults to the resolved capsule)' }),
  };
  static override flags = {
    session: Flags.string({ description: 'Capsule ID' }),
    json: Flags.boolean({ default: false }),
  };

  protected async execute(): Promise<void> {
    const { args, flags } = await this.parseInput(() => this.parse(Down));
    await this.executeDown({
      positional: args.capsule ?? null,
      capsuleFlag: flags.session ?? null,
      json: flags.json,
    });
  }
}
