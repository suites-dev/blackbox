import { Args, Flags } from '@oclif/core';

import { ReportCommand } from '../../operations/viewing/report-command.js';

export default class Report extends ReportCommand {
  static override summary = 'Write a capsule report (HTML and JSON by default).';
  static override args = {
    capsule: Args.string({ description: 'Capsule ID (defaults to the resolved capsule)' }),
  };
  static override flags = {
    format: Flags.string({ options: ['html', 'json'], description: 'Write only this format' }),
    output: Flags.string({
      description: 'Destination path (requires --format); - writes JSON to stdout',
    }),
    json: Flags.boolean({ default: false }),
  };

  protected async execute(): Promise<void> {
    const { args, flags } = await this.parseInput(() => this.parse(Report));
    await this.executeReport({
      positional: args.capsule ?? null,
      capsuleFlag: null,
      format: flags.format === undefined ? null : flags.format === 'html' ? 'html' : 'json',
      output: flags.output ?? null,
      json: flags.json,
    });
  }
}
