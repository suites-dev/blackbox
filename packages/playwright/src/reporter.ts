import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';

import { decodeEvent, progressAttachment } from './reporting/events.js';
import { policyOption, sandboxLifecycleOption, type PolicySettings } from './reporting/options.js';
import { evaluateRunnerPolicy, type RunnerPolicyResult } from './reporting/policy/runner-policy.js';
import { reportText } from './reporting/text.js';

/**
 * Native reporters own terminal rendering; Blackbox adds retained diagnostics and
 * surfaces the effective runner policy. Blackbox config metadata controls per-test
 * lifecycle output from fixtures.
 */
export default class BlackboxReporter implements Reporter {
  private readonly policySettings: PolicySettings;
  private runnerPolicy: RunnerPolicyResult | null = null;

  constructor(options: unknown = {}) {
    sandboxLifecycleOption(options);
    this.policySettings = policyOption(options);
  }

  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.runnerPolicy = evaluateRunnerPolicy(config, suite, this.policySettings);
    // stderr keeps stdout reporters (json, junit without outputFile) parseable.
    process.stderr.write(`${this.runnerPolicy.report}\n`);
  }

  onTestEnd(_test: TestCase, result: TestResult): void {
    if (this.runnerPolicy !== null) {
      result.attachments.push({
        name: 'blackbox-policy',
        contentType: 'text/plain',
        body: Buffer.from(this.runnerPolicy.report),
      });
    }
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

  onEnd(result: FullResult): Promise<{ status: FullResult['status'] } | undefined> {
    const failure = this.runnerPolicy === null ? null : this.runnerPolicy.failure;
    if (failure === null) {
      return Promise.resolve(undefined);
    }
    process.stderr.write(`${failure}\n`);
    return Promise.resolve(result.status === 'passed' ? { status: 'failed' } : undefined);
  }
}
