import { Args, Flags } from '@oclif/core';

import { ShowCommand } from '../../operations/inspection/show-command.js';

export default class Show extends ShowCommand {
  static override summary = 'Show a capsule, activity or trace (works on stopped capsules).';
  static override args = {
    id: Args.string({
      required: true,
      description: 'Capsule ID, activity ID or prefix, or trace ID',
    }),
  };
  static override flags = {
    capsule: Flags.string({ description: 'Search only this capsule' }),
    json: Flags.boolean({ default: false }),
  };

  protected async execute(): Promise<void> {
    const { args, flags } = await this.parseInput(() => this.parse(Show));
    await this.executeShow({ id: args.id, capsuleFlag: flags.capsule ?? null, json: flags.json });
  }
}
