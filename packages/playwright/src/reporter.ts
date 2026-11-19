import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

import { decodeEvent, progressAttachment } from './reporting/events.js';
import { sandboxLifecycleOption } from './reporting/options.js';
import { invocationVariable } from './reporting/capture/invocation.js';
import { reportText } from './reporting/text.js';
import { buildAttemptView, renderAttemptHtml, renderAttemptText } from './reporting/view/index.js';

interface ReportEntry {
  readonly path: string;
  readonly summary: string;
  readonly write: Promise<PromiseSettledResult<void>>;
}

/**
 * Native reporters own terminal rendering; Blackbox adds retained diagnostics.
 * Blackbox config metadata controls per-test lifecycle output from fixtures.
 */
export default class BlackboxReporter implements Reporter {
  private readonly reports: ReportEntry[] = [];
  private readonly failures: string[] = [];

  constructor(options: unknown = {}) {
    sandboxLifecycleOption(options);
  }

  /**
   * Runs in the process that starts the workers, so every attempt of this invocation inherits the same id.
   * A value the user already set is kept.
   */
  onBegin(): void {
    const existing = process.env[invocationVariable];
    if (existing === undefined || existing === '') {
      process.env[invocationVariable] = randomUUID();
    }
  }

  printsToStdio(): boolean {
    return false;
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const events = result.attachments.flatMap((attachment) => {
      if (attachment.name !== progressAttachment || attachment.body === undefined) {
        return [];
      }
      const event = decodeEvent(attachment.body);
      return event === null ? [] : [event];
    });
    if (events.length > 0) {
      result.attachments.push({
        name: 'blackbox-diagnostics',
        contentType: 'text/plain',
        body: Buffer.from(
          events
            .map((event) =>
              reportText(`${event.phase}: ${event.status}; ${event.detail} (+${event.elapsedMs}ms)`),
            )
            .join('\n'),
        ),
      });
    }

    if (!result.attachments.some(({ name }) => name === 'blackbox-attempt' || name === 'blackbox-execution')) {
      return;
    }
    try {
      const project = test.parent.project();
      if (project === undefined) {
        throw new Error('Blackbox attempt has no Playwright project');
      }
      const view = buildAttemptView(test, result);
      const slug = test.title.replaceAll(/[^a-zA-Z0-9]+/gu, '-').replaceAll(/^-|-$/gu, '').slice(0, 48) || 'scenario';
      const identity = createHash('sha256').update(test.id).digest('hex').slice(0, 12);
      const directory = join(project.outputDir, 'blackbox-report', `${slug}-${identity}`,
        `retry-${result.retry}-worker-${result.workerIndex}`);
      const jsonPath = join(directory, 'report.json');
      const htmlPath = join(directory, 'report.html');
      const json = JSON.stringify(view, null, 2);
      const html = renderAttemptHtml(view);
      result.attachments.push(
        { name: 'blackbox-report-json', contentType: 'application/json', body: Buffer.from(json) },
        { name: 'blackbox-report-html', contentType: 'text/html', body: Buffer.from(html) },
      );
      const write = (async () => {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeFile(jsonPath, json, { flag: 'wx', mode: 0o600 });
        await writeFile(htmlPath, html, { flag: 'wx', mode: 0o600 });
      })().then(
        () => ({ status: 'fulfilled' as const, value: undefined }),
        (reason: unknown) => ({ status: 'rejected' as const, reason }),
      );
      this.reports.push({ path: htmlPath, summary: renderAttemptText(view), write });
    } catch (error) {
      this.failures.push(reportText(error instanceof Error ? error.message : String(error)));
    }
  }

  async onEnd(): Promise<{ status: FullResult['status'] } | undefined> {
    const writes = await Promise.all(this.reports.map(({ write }) => write));
    for (const [index, write] of writes.entries()) {
      const report = this.reports[index];
      process.stdout.write(`${report.summary}\n`);
      if (write.status === 'fulfilled') {
        process.stdout.write(`  ${report.path}\n`);
      } else {
        this.failures.push(reportText(write.reason instanceof Error ? write.reason.message : String(write.reason)));
      }
    }
    for (const failure of this.failures) {
      process.stderr.write(`Blackbox report failed: ${failure}\n`);
    }
    return this.failures.length > 0 ? { status: 'failed' } : undefined;
  }
}
