import type { ReportSelection } from '@suites/blackbox-report-server';

import { BlackboxCommand } from '../../cli/base-command.js';
import { EXIT_CODES } from '../../cli/exit-codes.js';
import { openBrowser, type OpenBrowserInput } from '../../reporting/browser.js';
import { capsuleReportProvider } from '../../reporting/capsule-provider.js';
import { serveReport } from '../../reporting/serve.js';

export type ViewerTarget =
  { readonly kind: 'registry' } | { readonly kind: 'capsule'; readonly capsule: string };

export interface ViewerAnnouncement {
  readonly kind: 'report-server-started' | 'report-server-reused';
  readonly url: string;
}

export interface ServePresentation {
  readonly announce: (input: ViewerAnnouncement) => void;
  readonly browserResult: (
    input: ViewerAnnouncement & { readonly browser: 'opened' | 'not-opened' },
  ) => void;
}

/** serveReport always announces before it launches or warns; this is a type-level fallback. */
function announcedOrUrl(announced: ViewerAnnouncement | null, url: string): ViewerAnnouncement {
  return announced ?? { kind: 'report-server-started', url };
}

function selection(target: ViewerTarget): ReportSelection {
  return target.kind === 'registry'
    ? { kind: 'registry' }
    : { kind: 'report', type: 'capsule', id: target.capsule };
}

/**
 * `capsule report serve`. If this process started the viewer it stays in the
 * foreground until Ctrl-C; a reused viewer returns.
 */
export abstract class ReportServeCommand extends BlackboxCommand {
  protected async serve(input: {
    readonly target: ViewerTarget;
    readonly port: number;
    readonly browser: boolean;
    readonly presentation: ServePresentation;
  }): Promise<void> {
    let announced: ViewerAnnouncement | null = null;
    const { presentation } = input;
    await serveReport({
      kind: 'serve-report',
      projectDirectory: process.cwd(),
      provider: capsuleReportProvider({ projectDirectory: process.cwd() }),
      port: input.port,
      selection: selection(input.target),
      announce: (announcement) => {
        announced = announcement;
        presentation.announce(announcement);
        if (!input.browser) {
          presentation.browserResult({ ...announcement, browser: 'not-opened' });
        }
      },
      browser: input.browser
        ? {
            kind: 'open',
            launch: async (request: OpenBrowserInput) => {
              await openBrowser(request);
              presentation.browserResult({
                ...announcedOrUrl(announced, request.url),
                browser: 'opened',
              });
            },
            warn: ({ message }) => {
              this.human([`blackbox: ${message}`]);
              presentation.browserResult({
                ...announcedOrUrl(announced, ''),
                browser: 'not-opened',
              });
            },
          }
        : { kind: 'none' },
    });
    this.finish(EXIT_CODES.success);
  }
}
