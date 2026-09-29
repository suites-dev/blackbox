import { Flags } from '@oclif/core';

import { RunCommand } from '../../operations/run/run-command.js';

/** Hidden alias: `capsule exec --session X [--driver D] -- cmd` → `run --capsule X [--via D] -- cmd`. */
export default class CapsuleExec extends RunCommand {
  static override hidden = true;
  static override strict = false;
  static override description = 'Run a host command or use a catalog driver.';
  static override flags = {
    session: Flags.string({ required: true }),
    name: Flags.string({ description: 'Human-readable name retained with the activity.' }),
    driver: Flags.string(),
    purpose: Flags.string({
      default: 'stimulus',
      options: ['setup', 'stimulus', 'inspection'],
    }),
    'allow-untraced': Flags.boolean({ default: false }),
    json: Flags.boolean({ default: false }),
  };

  protected async execute(): Promise<void> {
    const { flags } = await this.parseInput(() => this.parse(CapsuleExec));
    await this.executeRun({
      capsuleFlag: flags.session,
      driver: flags.driver ?? null,
      driverFlag: '--driver',
      name: flags.name ?? null,
      purpose: flags.purpose as 'setup' | 'stimulus' | 'inspection',
      allowUntraced: flags['allow-untraced'],
      json: flags.json,
    });
  }
}
