import { Command, Flags } from '@oclif/core';
import { DEFAULT_REPORT_PORT } from '@suites/blackbox-report-server-internal';
import { capsuleReportProvider } from '#reporting/capsule-provider';
import { openBrowser } from '#reporting/browser';
import { serveReport } from '#reporting/serve';

export default class CapsuleReportServe extends Command {
  static override description = 'Start or reuse the local Capsule report viewer; the owner stays until Ctrl-C.';
  static override examples = [
    '<%= config.bin %> capsule report serve --open',
    '<%= config.bin %> capsule report serve --session quiet-river-ada --open',
  ];
  static override flags = {
    session: Flags.string({ description: 'Initially select this exact session' }),
    port: Flags.integer({ min: 0, max: 65535, default: DEFAULT_REPORT_PORT, description: `HTTP port (default: ${String(DEFAULT_REPORT_PORT)})` }),
    open: Flags.boolean({ default: false, description: 'Open flight control in the default browser' }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(CapsuleReportServe);
    await serveReport({ kind: 'serve-report', projectDirectory: process.cwd(), provider: capsuleReportProvider({ projectDirectory: process.cwd() }),
      port: flags.port,
      selection: flags.session === undefined ? { kind: 'registry' } : { kind: 'report', type: 'capsule', id: flags.session },
      announce: ({ kind, url }) => { this.log(`Blackbox reports: ${url}`); this.log(`Viewer ownership: ${kind === 'report-server-reused' ? 'reused' : 'started'}`); if (kind === 'report-server-started') {this.log('Press Ctrl-C to stop the viewer. Capsules keep running.');} },
      browser: flags.open ? { kind: 'open', launch: openBrowser, warn: ({ message }) => { this.warn(message); } } : { kind: 'none' },
    });
  }
}
