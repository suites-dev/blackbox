import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import {
  ensureReportServer,
  type ReportProvider,
  type ReportSelection,
} from '@suites/blackbox-report-server-internal';

import type { OpenBrowserInput } from './browser.js';

export interface ServeReportInput {
  kind: 'serve-report';
  provider: ReportProvider;
  port: number;
  selection: ReportSelection;
  projectDirectory: string;
  browser:
    | { kind: 'none' }
    | {
        kind: 'open';
        launch(input: OpenBrowserInput): Promise<void>;
        warn(input: { message: string }): void;
      };
  announce(input: { kind: 'report-server-started' | 'report-server-reused'; url: string }): void;
}

export async function serveReport(input: ServeReportInput): Promise<void> {
  const scopeId = createHash('sha256')
    .update(await realpath(input.projectDirectory))
    .digest('hex');
  const result = await ensureReportServer({
    kind: 'ensure-report-server',
    providers: [input.provider],
    port: input.port,
    scopeId,
    selection: input.selection,
  });
  if (result.kind === 'report-server-reused') {
    input.announce({ kind: 'report-server-reused', url: result.url });
    await openBrowserIfRequested(input, result.url);
    return;
  }
  const server = result.server;
  let release = (): void => {
    /* Assigned before signal handlers are attached. */
  };
  const stopped = new Promise<void>((resolve) => {
    release = resolve;
  });
  process.once('SIGINT', release);
  process.once('SIGTERM', release);
  try {
    input.announce({ kind: 'report-server-started', url: server.url });
    await openBrowserIfRequested(input, server.url);
    await stopped;
  } finally {
    process.off('SIGINT', release);
    process.off('SIGTERM', release);
    await server.close();
  }
}

async function openBrowserIfRequested(input: ServeReportInput, url: string): Promise<void> {
  if (input.browser.kind !== 'open') {
    return;
  }
  try {
    await input.browser.launch({ kind: 'open-browser', url });
  } catch {
    input.browser.warn({ message: `Could not open a browser. The viewer is running at ${url}` });
  }
}
