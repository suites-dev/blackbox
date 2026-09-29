import { Flags } from '@oclif/core';

import { ReportCommand } from '../../../operations/viewing/report-command.js';

/** Hidden alias: `capsule report export --session X --format F` → `report X --format F`. */
export default class CapsuleReportExport extends ReportCommand {
  static override hidden = true;
  static override description =
    'Export a snapshot of an exact Capsule session, running or stopped.';
  static override examples = [
    '<%= config.bin %> capsule report export --session quiet-river-ada --format html',
    '<%= config.bin %> capsule report export --session quiet-river-ada --format json --output -',
  ];
  static override flags = {
    session: Flags.string({ required: true, description: 'Exact session ID' }),
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
