import { Command, Flags } from '@oclif/core';
import { capsuleReportProvider } from '#reporting/capsule-provider';
import { openBrowser } from '#reporting/browser';
import { serveReport } from '#reporting/serve';

export default class CapsuleReportServe extends Command {
  static override description = 'Serve the live Capsule registry until Ctrl-C; Capsules keep running.';
  static override examples = [
    '<%= config.bin %> capsule report serve --open',
    '<%= config.bin %> capsule report serve --session quiet-river-ada --open',
  ];
  static override flags = {
    session: Flags.string({ description: 'Initially select this exact session' }),
    port: Flags.integer({ min: 0, max: 65535, default: 0, description: 'HTTP port (0 selects an available port)' }),
    open: Flags.boolean({ default: false, description: 'Open flight control in the default browser' }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(CapsuleReportServe);
    await serveReport({ kind: 'serve-report', provider: capsuleReportProvider({ projectDirectory: process.cwd() }),
      port: flags.port,
      selection: flags.session === undefined ? { kind: 'registry' } : { kind: 'report', type: 'capsule', id: flags.session },
      announce: ({ url }) => { this.log(`Blackbox reports: ${url}\nPress Ctrl-C to stop the viewer. Capsules keep running.`); },
      browser: flags.open ? { kind: 'open', launch: openBrowser, warn: ({ message }) => { this.warn(message); } } : { kind: 'none' },
    });
  }
}
