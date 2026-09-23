import { Args, Command, Flags } from '@oclif/core';

export default class InstrumentationBundleGenerate extends Command {
  static override description = 'Generate a user-owned runtime instrumentation bundle.';
  static override args = { runtime: Args.string({ required: false, default: 'node' }) };
  static override flags = { json: Flags.boolean({ default: false }) };
  public async run(): Promise<void> {
    await this.parse(InstrumentationBundleGenerate);
    this.error('instrumentation bundle generate: not implemented yet. Instrumentation bundle generation has no backend yet.', { exit: 3 });
  }
}
