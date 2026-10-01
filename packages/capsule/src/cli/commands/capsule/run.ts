import { Flags } from '@oclif/core';

import { RunCommand } from '../../operations/run/run-command.js';
import { DEFAULT_WAIT_CAP_MS } from '../../operations/run/run-wait.js';

export default class Run extends RunCommand {
  static override strict = false;
  static override summary = 'Run a command against a capsule and retain it as an activity.';
  static override description =
    'Runs on the host, or through a catalog driver with --via. The child exit code is passed through; Blackbox failures exit 125.';
  static override usage =
    'capsule run [--via <driver>] [--session <id>] [--name <name>] [--wait <ms>] [--json] -- <command...>';
  static override flags = {
    via: Flags.string({ description: 'Catalog driver to run the command through' }),
    session: Flags.string({
      description: 'Capsule ID (defaults to BLACKBOX_CAPSULE, then the current capsule)',
    }),
    name: Flags.string({ description: 'Human-readable name retained with the activity.' }),
    purpose: Flags.string({
      default: 'stimulus',
      options: ['setup', 'stimulus', 'inspection'],
    }),
    'allow-untraced': Flags.boolean({ default: false }),
    wait: Flags.integer({
      description:
        'Longest wait for telemetry after the command exits, in milliseconds (default 5000; 0 does not wait)',
      min: 0,
    }),
    json: Flags.boolean({ default: false }),
  };

  protected async execute(): Promise<void> {
    const { flags } = await this.parseInput(() => this.parse(Run));
    await this.executeRun({
      capsuleFlag: flags.session ?? null,
      driver: flags.via ?? null,
      name: flags.name ?? null,
      purpose: flags.purpose as 'setup' | 'stimulus' | 'inspection',
      allowUntraced: flags['allow-untraced'],
      json: flags.json,
      waitMs: flags.wait ?? DEFAULT_WAIT_CAP_MS,
    });
  }
}
