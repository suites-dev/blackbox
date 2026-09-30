import { Args, Flags } from '@oclif/core';

import { BlackboxCommand } from '../../cli/base-command.js';
import { EXIT_CODES } from '../../cli/exit-codes.js';
import { cliFailure } from '../../cli/failure.js';
import { setCurrentCapsule } from '../../context/current-capsule.js';
import { InvocationContext } from '../../context/invocation.js';

export default class Use extends BlackboxCommand {
  static override summary = 'Make a capsule current (allowed in any state).';
  static override args = {
    capsule: Args.string({ required: true, description: 'Exact capsule ID' }),
  };
  static override flags = { json: Flags.boolean({ default: false }) };

  protected async execute(): Promise<void> {
    const { args, flags } = await this.parseInput(() => this.parse(Use));
    const context = new InvocationContext(process.cwd());
    const summary = (await context.index()).capsule(args.capsule);
    if (summary === null) {
      throw cliFailure('id-unknown', `no capsule, activity or trace matches ${args.capsule}`, [
        'blackbox capsule ls --all',
      ]);
    }
    const previous = await context.current();
    try {
      await setCurrentCapsule(process.cwd(), summary.capsule);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw cliFailure(
        'current-capsule-write-failed',
        `capsule ${summary.capsule} could not be made current (${message})`,
        [],
      );
    }
    if (flags.json) {
      this.json({
        kind: 'capsule-selected',
        capsule: summary.capsule,
        system: summary.system,
        state: summary.state,
        previous,
        next: [],
      });
    } else {
      this.human([`current capsule: ${summary.capsule} (${summary.system}, ${summary.state})`]);
    }
    this.finish(EXIT_CODES.success);
  }
}
