import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Reporter, TestCase, TestResult, TestStep } from '@playwright/test/reporter';
import { decodeEvent, progressAttachment } from '../../reporting/events.js';

/** Test-only handshake proves diagnostic attachments arrive during blocked setup. */
export default class ProgressObserver implements Reporter {
  printsToStdio(): boolean {
    return false;
  }

  onStepEnd(_test: TestCase, _result: TestResult, step: TestStep): void {
    for (const attachment of step.attachments) {
      if (attachment.name !== progressAttachment || attachment.body === undefined) {
        continue;
      }
      const event = decodeEvent(attachment.body);
      if (event !== null && event.phase === 'acquisition' && event.status === 'started') {
        writeFileSync(join(process.cwd(), 'reporter-observed-startup'), 'observed');
      }
    }
  }
}
