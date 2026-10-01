import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestError,
  TestResult,
  TestStep,
} from '@playwright/test/reporter';

import { decodeEvent, progressAttachment } from './reporting/events.js';
import { reportText } from './reporting/text.js';

export default class BlackboxReporter implements Reporter {
  private readonly attempts = new Map<
    TestResult,
    { number: number; seen: Set<number>; elapsedMs: number }
  >();
  private suite: Suite | null = null;

  printsToStdio(): boolean {
    return true;
  }

  onBegin(_config: FullConfig, suite: Suite): void {
    this.suite = suite;
    this.write(`Blackbox · ${suite.allTests().length} tests`);
  }

  onTestBegin(test: TestCase, result: TestResult): void {
    const number = this.attempts.size + 1;
    this.attempts.set(result, { number, seen: new Set(), elapsedMs: 0 });
    this.write(
      `[${number}] ${test.titlePath().filter(Boolean).join(' › ')} · attempt ${result.retry + 1}`,
    );
  }

  onStepBegin(_test: TestCase, result: TestResult, step: TestStep): void {
    if (step.category === 'test.step') {
      this.line(result, `→ ${this.stepTitle(step)}`);
    }
  }

  onStepEnd(_test: TestCase, result: TestResult, step: TestStep): void {
    this.progress(result, step.attachments);
    if (step.category === 'test.step') {
      this.line(
        result,
        `${step.error === undefined ? '✓' : '✘'} ${this.stepTitle(step)} (${step.duration}ms)`,
      );
    }
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    // Also handles replayed results and attachments emitted during failed teardown.
    this.progress(result, result.attachments);
    const expected = result.status === test.expectedStatus;
    const attempt = this.attempts.get(result);
    const duration = Math.max(result.duration, attempt === undefined ? 0 : attempt.elapsedMs);
    this.line(
      result,
      `${result.status === 'skipped' ? '·' : expected ? '✓' : '✘'} ${result.status}${test.expectedStatus !== 'passed' ? ` (expected ${test.expectedStatus})` : ''} · ${duration}ms total`,
    );
    for (const error of result.errors) {
      this.line(result, error.message ?? error.value ?? 'test failed');
    }
  }

  onEnd(result: FullResult): void {
    const counts = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
    if (this.suite !== null) {
      for (const test of this.suite.allTests()) {
        counts[test.outcome()]++;
      }
    }
    this.write(
      `Blackbox · ${result.status} · ${counts.expected} expected, ${counts.unexpected} unexpected, ${counts.flaky} flaky, ${counts.skipped} skipped · ${this.attempts.size} attempts`,
    );
  }

  onError(error: TestError): void {
    this.write(error.message ?? error.value ?? 'Playwright error');
  }
  onStdOut(chunk: string | Buffer): void {
    process.stdout.write(chunk);
  }
  onStdErr(chunk: string | Buffer): void {
    process.stderr.write(chunk);
  }

  private progress(result: TestResult, attachments: TestResult['attachments']): void {
    const attempt = this.attempts.get(result);
    if (attempt === undefined) {
      return;
    }
    for (const attachment of attachments) {
      if (attachment.name !== progressAttachment || attachment.body === undefined) {
        continue;
      }
      const event = decodeEvent(attachment.body);
      if (event === null || attempt.seen.has(event.sequence)) {
        continue;
      }
      attempt.seen.add(event.sequence);
      attempt.elapsedMs = Math.max(attempt.elapsedMs, event.elapsedMs);
      const marker = { started: '→', completed: '✓', failed: '✘', info: '·' }[event.status];
      this.line(result, `${marker} ${event.phase}: ${event.detail} (+${event.elapsedMs}ms)`);
    }
  }

  private stepTitle(step: TestStep): string {
    const titles = [step.title];
    for (let parent = step.parent; parent !== undefined; parent = parent.parent) {
      if (parent.category === 'test.step') {
        titles.unshift(parent.title);
      }
    }
    return titles.join(' › ');
  }

  private line(result: TestResult, message: string): void {
    const attempt = this.attempts.get(result);
    this.write(`[${attempt === undefined ? '?' : attempt.number}]   ${message}`);
  }

  private write(message: string): void {
    process.stdout.write(`${reportText(message)}\n`);
  }
}
