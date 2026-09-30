import { Args, Flags } from '@oclif/core';
import { DEFAULT_REPORT_PORT } from '@suites/blackbox-report-server';

import { OpenCommand } from '../operations/viewing/open-command.js';

export default class Open extends OpenCommand {
  static override summary = 'Open flight control for a capsule, or for all capsules.';
  static override args = {
    id: Args.string({ description: 'Capsule, activity or trace ID (selects its capsule)' }),
  };
  static override flags = {
    port: Flags.integer({
      min: 0,
      max: 65535,
      default: DEFAULT_REPORT_PORT,
      description: `HTTP port (default: ${String(DEFAULT_REPORT_PORT)})`,
    }),
    browser: Flags.boolean({
      default: true,
      allowNo: true,
      description: 'Open the default browser',
    }),
    json: Flags.boolean({ default: false }),
  };

  protected async execute(): Promise<void> {
    const { args, flags } = await this.parseInput(() => this.parse(Open));
    const target = await this.target(args.id ?? null);
    const capsule = target.kind === 'capsule' ? target.capsule : null;
    await this.serve({
      target,
      port: flags.port,
      browser: flags.browser,
      presentation: {
        announce: ({ kind, url }) => {
          if (flags.json) {
            return;
          }
          this.human([
            `flight control: ${url}`,
            `showing: ${capsule ?? 'all capsules'}`,
            kind === 'report-server-reused'
              ? 'viewer: reused'
              : 'viewer: started, press Ctrl-C to stop; capsules keep running',
          ]);
        },
        browserResult: ({ kind, url, browser }) => {
          if (flags.json) {
            this.json({
              kind: 'viewer-open',
              capsule,
              url,
              ownership: kind === 'report-server-reused' ? 'reused' : 'started',
              browser,
            });
          }
        },
      },
    });
  }
}
