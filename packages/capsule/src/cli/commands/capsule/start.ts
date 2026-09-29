import { Flags } from '@oclif/core';

import { UpCommand } from '../../operations/up/up-command.js';

/** Hidden alias: `capsule start --system X` → `up X`. */
export default class CapsuleStart extends UpCommand {
  static override hidden = true;
  static override description = 'Start an interactive Capsule for a catalog system.';
  static override flags = {
    system: Flags.string({ required: true }),
    title: Flags.string({ description: 'Human-readable title shown in the report registry' }),
    description: Flags.string({ description: 'Free-form context shown with the report' }),
    env: Flags.string({ multiple: true }),
    json: Flags.boolean({ default: false }),
    interactive: Flags.boolean(),
    'non-interactive': Flags.boolean(),
    silent: Flags.boolean(),
    'no-color': Flags.boolean(),
  };

  protected async execute(): Promise<void> {
    const { flags } = await this.parseInput(() => this.parse(CapsuleStart));
    await this.executeUp({
      system: flags.system,
      title: flags.title ?? null,
      description: flags.description ?? null,
      env: flags.env ?? [],
      json: flags.json,
      interactive: flags.interactive,
      nonInteractive: flags['non-interactive'],
      silent: flags.silent,
      noColor: flags['no-color'],
    });
  }
}
