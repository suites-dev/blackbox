import { Flags } from '@oclif/core';

import { ReportCommand } from '../../../operations/viewing/report-command.js';

export default class CapsuleReportExport extends ReportCommand {
  static override summary = 'Export a snapshot of an exact capsule, running or stopped.';
  static override examples = [
    '<%= config.bin %> capsule report export --session quiet-river-ada --format html',
    '<%= config.bin %> capsule report export --session quiet-river-ada --format json --output -',
  ];
  static override flags = {
    session: Flags.string({ required: true, description: 'Exact capsule ID' }),
    format: Flags.string({
      required: true,
      options: ['html', 'json'],
      description: 'Exported artifact format',
    }),
    output: Flags.string({ description: 'Destination path; use - for JSON on stdout' }),
  };

  protected async execute(): Promise<void> {
    const { flags } = await this.parseInput(() => this.parse(CapsuleReportExport));
    await this.executeReport({
      positional: null,
      capsuleFlag: flags.session,
      format: flags.format === 'html' ? 'html' : 'json',
      output: flags.output ?? null,
      json: false,
    });
  }
}
