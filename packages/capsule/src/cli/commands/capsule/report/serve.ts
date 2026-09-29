import { DEFAULT_REPORT_PORT } from '@suites/blackbox-report-server';
import { Flags } from '@oclif/core';

import { InvocationContext } from '../../../context/invocation.js';
import { ReportServeCommand } from '../../../operations/viewing/report-serve-command.js';

/**
 * Without --session the viewer shows the registry, and the browser opens only
 * with --open. Its three lines keep today's exact text because the E2E harness
 * parses them.
 */
export default class CapsuleReportServe extends ReportServeCommand {
  static override summary =
    'Start or reuse the local capsule report viewer; the owner stays until Ctrl-C.';
  static override examples = [
    '<%= config.bin %> capsule report serve --open',
    '<%= config.bin %> capsule report serve --session quiet-river-ada --open',
  ];
  static override flags = {
    session: Flags.string({ description: 'Initially select this exact capsule' }),
    port: Flags.integer({
      min: 0,
      max: 65535,
      default: DEFAULT_REPORT_PORT,
      description: `HTTP port (default: ${String(DEFAULT_REPORT_PORT)})`,
    }),
    open: Flags.boolean({
      default: false,
      description: 'Open flight control in the default browser',
    }),
  };

  protected async execute(): Promise<void> {
    const { flags } = await this.parseInput(() => this.parse(CapsuleReportServe));
    // --session resolves through the registry like every explicit capsule; an
    // unlisted one fails as capsule-not-found. Without it: the registry, never
    // BLACKBOX_CAPSULE or the current capsule.
    const explicit =
      flags.session === undefined
        ? null
        : await new InvocationContext(process.cwd()).explicit(flags.session, 'report');
    await this.serve({
      target:
        explicit === null ? { kind: 'registry' } : { kind: 'capsule', capsule: explicit.capsule },
      port: flags.port,
      browser: flags.open,
      presentation: {
        announce: ({ kind, url }) => {
          this.human([
            `Blackbox reports: ${url}`,
            `Viewer ownership: ${kind === 'report-server-reused' ? 'reused' : 'started'}`,
            ...(kind === 'report-server-started'
              ? ['Press Ctrl-C to stop the viewer. Capsules keep running.']
              : []),
          ]);
        },
        browserResult: () => undefined,
      },
    });
  }
}
