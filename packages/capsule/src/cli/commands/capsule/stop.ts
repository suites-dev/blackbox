import { Flags } from '@oclif/core';

import { DownCommand } from '../../operations/lifecycle/down-command.js';

/** Hidden alias: `capsule stop --session X` → `down X` (X taken as explicit capsule context). */
export default class CapsuleStop extends DownCommand {
  static override hidden = true;
  static override description = 'Stop a Capsule and finalize its durable record.';
  static override flags = {
    session: Flags.string({ required: true }),
    json: Flags.boolean({ default: false }),
  };

  protected async execute(): Promise<void> {
    const { flags } = await this.parseInput(() => this.parse(CapsuleStop));
    await this.executeDown({ positional: null, capsuleFlag: flags.session, json: flags.json });
  }
}
