import { Args, Flags } from '@oclif/core';

import { UpCommand } from '../../operations/up/up-command.js';

export default class Up extends UpCommand {
  static override summary = 'Start a capsule for a catalog system and make it current.';
  static override args = {
    system: Args.string({ description: 'Catalog system (defaults to the catalog default)' }),
  };
  static override flags = {
    title: Flags.string({ description: 'Human-readable title shown in the report registry' }),
    description: Flags.string({ description: 'Free-form context shown with the report' }),
    env: Flags.string({
      multiple: true,
      description: 'KEY=VALUE passed to the system (repeatable)',
    }),
    json: Flags.boolean({ default: false }),
    interactive: Flags.boolean(),
    'non-interactive': Flags.boolean(),
    silent: Flags.boolean(),
    'no-color': Flags.boolean(),
  };

  protected async execute(): Promise<void> {
    const { args, flags } = await this.parseInput(() => this.parse(Up));
    await this.executeUp({
      system: args.system ?? null,
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
