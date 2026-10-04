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
    session: Flags.string({ description: 'Search only this capsule' }),
    spans: Flags.boolean({ default: false, description: 'For a trace: one row per span' }),
    full: Flags.boolean({
      default: false,
      description: 'For an activity: print every span instead of folding a large tree',
    }),
    timeline: Flags.boolean({
      default: false,
      description: 'For a capsule: activities and traces in time order',
    }),
    json: Flags.boolean({ default: false }),
  };

  protected async execute(): Promise<void> {
    const { args, flags } = await this.parseInput(() => this.parse(Show));
    await this.executeShow({
      id: args.id,
      capsuleFlag: flags.session ?? null,
      json: flags.json,
      spans: flags.spans,
      timeline: flags.timeline,
      full: flags.full,
    });
  }
}
