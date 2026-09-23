import { Command, Flags } from '@oclif/core';

export default class EffectsBaselineUpdate extends Command {
  static override description = 'Explicitly accept an eligible exact-run baseline.';
  static override flags = { run: Flags.string({ required: true }), json: Flags.boolean({ default: false }) };
  public async run(): Promise<void> {
    await this.parse(EffectsBaselineUpdate);
    this.error('effects baseline update: not implemented yet. Effects baseline acceptance has no backend yet.', { exit: 3 });
  }
}
