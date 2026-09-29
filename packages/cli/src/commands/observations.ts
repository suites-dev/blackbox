import { Flags } from '@oclif/core';

import { ShowCommand } from '../operations/inspection/show-command.js';

/**
 * Hidden alias: `observations --session X` → `show X`;
 * `--activity A` → `show A --capsule X`; `--trace T` → `show T --capsule X`.
 */
export default class Observations extends ShowCommand {
  static override hidden = true;
  static override description = 'Query exact retained raw observations.';
  static override flags = {
    session: Flags.string({ required: true }),
    activity: Flags.string(),
    trace: Flags.string(),
    json: Flags.boolean({ default: false }),
  };

  protected async execute(): Promise<void> {
    const { flags } = await this.parseInput(() => this.parse(Observations));
    if (flags.activity !== undefined && flags.trace !== undefined) {
      throw this.usageFailure('--activity and --trace cannot be used together');
    }
    await this.executeShow({
      id: flags.activity ?? flags.trace ?? flags.session,
      capsuleFlag: flags.session,
      json: flags.json,
    });
  }
}
