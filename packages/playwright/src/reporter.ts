import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

import { decodeEvent, progressAttachment } from './reporting/events.js';
import { sandboxLifecycleOption } from './reporting/options.js';
import { reportText } from './reporting/text.js';

/**
 * Native reporters own terminal rendering; Blackbox adds retained diagnostics.
 * Blackbox config metadata controls per-test lifecycle output from fixtures.
 */
export default class BlackboxReporter implements Reporter {
  constructor(options: unknown = {}) {
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
            reportText(`${event.phase}: ${event.status}; ${event.detail} (+${event.elapsedMs}ms)`),
          )
          .join('\n'),
      ),
    });
  }
}
