import { randomUUID } from 'node:crypto';

import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

import { decodeEvent, progressAttachment } from './reporting/events.js';
import { sandboxLifecycleOption } from './reporting/options.js';
import { invocationVariable } from './reporting/invocation.js';
import { reportText } from './reporting/text.js';

/**
 * Native reporters own terminal rendering; Blackbox adds retained diagnostics.
 * Blackbox config metadata controls per-test lifecycle output from fixtures.
 */
export default class BlackboxReporter implements Reporter {
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
