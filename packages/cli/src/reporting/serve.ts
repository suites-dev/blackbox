import { startReportServer, type ReportProvider, type ReportSelection } from '@suites/blackbox-report-server-internal';

import type { OpenBrowserInput } from './browser.js';

export interface ServeReportInput {
  kind: 'serve-report';
  provider: ReportProvider;
  port: number;
  selection: ReportSelection;
  browser: { kind: 'none' } | { kind: 'open'; launch(input: OpenBrowserInput): Promise<void>; warn(input: { message: string }): void };
  announce(input: { kind: 'report-server-ready'; url: string }): void;
}

export async function serveReport(input: ServeReportInput): Promise<void> {
  const server = await startReportServer({ kind: 'start-report-server', providers: [input.provider], port: input.port, selection: input.selection });
  let release = (): void => { /* Assigned before signal handlers are attached. */ };
  const stopped = new Promise<void>(resolve => { release = resolve; });
  process.once('SIGINT', release);
  process.once('SIGTERM', release);
  try {
    input.announce({ kind: 'report-server-ready', url: server.url });
    if (input.browser.kind === 'open') {
      try { await input.browser.launch({ kind: 'open-browser', url: server.url }); }
      catch { input.browser.warn({ message: `Could not open a browser. The viewer is running at ${server.url}` }); }
    }
    await stopped;
  } finally {
    process.off('SIGINT', release);
    process.off('SIGTERM', release);
    await server.close();
  }
}
