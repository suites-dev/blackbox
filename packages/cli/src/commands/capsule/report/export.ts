import { Command, Flags } from '@oclif/core';
import { reportCapsule } from '@suites/blackbox-capsule-internal';
import { capsuleFailure } from '#capsule-output';
import { exportReport } from '#reporting/export';

export default class CapsuleReportExport extends Command {
  static override description = 'Export a snapshot of an exact Capsule session, running or stopped.';
  static override examples = [
    '<%= config.bin %> capsule report export --session quiet-river-ada --format html',
    '<%= config.bin %> capsule report export --session quiet-river-ada --format json --output -',
  ];
  static override flags = {
    session: Flags.string({ required: true, description: 'Exact session ID' }),
    format: Flags.string({ required: true, options: ['html', 'json'], description: 'Exported artifact format' }),
    output: Flags.string({ description: 'Destination path; use - for JSON on stdout' }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(CapsuleReportExport);
    if (flags.output === '-' && flags.format !== 'json') {
      this.error('--output - requires --format json.', { exit: 2 });
    }
    const result = await reportCapsule({ projectDirectory: process.cwd(), sessionId: flags.session });
    if (result.kind !== 'capsule-report') {
      this.error(capsuleFailure({ result, json: false }), { exit: 1 });
    }
    const destination = flags.output === '-'
      ? { kind: 'stdout' as const }
      : flags.output === undefined ? { kind: 'default' as const } : { kind: 'file' as const, path: flags.output };
    try {
      const exported = await exportReport({ kind: 'export-report', projectDirectory: process.cwd(),
        format: flags.format === 'html' ? 'html' : 'json', document: result.document, destination });
      if (exported.kind === 'stdout') { process.stdout.write(exported.content); }
      else { this.log(exported.path); }
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error), { exit: 4 });
    }
  }
}
