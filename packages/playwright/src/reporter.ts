import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

import { decodeEvent, progressAttachment } from './reporting/events.js';
import { sandboxLifecycleOption, type BlackboxReporterOptions } from './reporting/options.js';
import { reportText } from './reporting/text.js';

export type { BlackboxReporterOptions } from './reporting/options.js';

/**
 * Native reporters own terminal rendering; Blackbox adds retained diagnostics.
 * Fixtures read these reporter options from FullConfig to emit per-test stdout.
 */
export default class BlackboxReporter implements Reporter {
  constructor(options: BlackboxReporterOptions = { sandboxLifecycle: true }) {
    sandboxLifecycleOption(options);
  }

  printsToStdio(): boolean {
    return false;
  }

  onTestEnd(_test: TestCase, result: TestResult): void {
    const events = result.attachments.flatMap((attachment) => {
      if (attachment.name !== progressAttachment || attachment.body === undefined) {
        return [];
      }
      const event = decodeEvent(attachment.body);
      return event === null ? [] : [event];
    });
    if (events.length === 0) {
      return;
    }
    result.attachments.push({
      name: 'blackbox-diagnostics',
      contentType: 'text/plain',
      body: Buffer.from(
        events
          .map((event) =>
            reportText(
              (event.sandboxId === null ? '' : `[${event.sandboxId}] `) +
                `${event.phase}: ${event.status}; ${event.detail} (+${event.elapsedMs}ms)`,
            ),
          )
          .join('\n'),
      ),
    });
  }
}
