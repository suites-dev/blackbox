import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  FullResult,
  Reporter,
  TestCase,
  TestResult,
  TestStep,
} from '@playwright/test/reporter';

interface Event {
  readonly phase: string;
  readonly status: string;
  readonly sequence: number;
  readonly detail: string;
}

/** Acceptance oracle: observe worker events before the test result is finalized. */
export default class BlackboxEvidence implements Reporter {
  private readonly attempts = new Map<
    TestResult,
    {
      title: string;
      file: string;
      acquisitionStartedAt: number | null;
      acquisitionCompletedAt: number | null;
      testId: string;
      retry: number;
      workerIndex: number;
      parallelIndex: number;
      sandboxId: string | null;
      events: Event[];
      businessSteps: number;
      nestedSteps: number;
      errors: string[];
    }
  >();

  printsToStdio(): boolean {
    return false;
  }

  onTestBegin(test: TestCase, result: TestResult): void {
    this.attempts.set(result, {
      title: test.title,
      file: test.location.file,
      acquisitionStartedAt: null,
      acquisitionCompletedAt: null,
      testId: test.id,
      retry: result.retry,
      workerIndex: result.workerIndex,
      parallelIndex: result.parallelIndex,
      sandboxId: null,
      events: [],
      businessSteps: 0,
      nestedSteps: 0,
      errors: [],
    });
  }

  onStepBegin(_test: TestCase, result: TestResult, step: TestStep): void {
    const attempt = this.attempts.get(result);
    if (attempt === undefined || step.category !== 'test.step') {
      return;
    }
    attempt.businessSteps++;
    if (step.parent !== undefined && step.parent.category === 'test.step') {
      attempt.nestedSteps++;
    }
    if (
      !attempt.events.some((event) => event.phase === 'readiness' && event.status === 'completed')
    ) {
      attempt.errors.push('Business step started before live readiness was reported');
    }
  }

  onStepEnd(_test: TestCase, result: TestResult, step: TestStep): void {
    const attempt = this.attempts.get(result);
    if (attempt === undefined) {
      return;
    }
    for (const attachment of step.attachments) {
      if (attachment.name !== 'blackbox-progress' || attachment.body === undefined) {
        continue;
      }
      const event = JSON.parse(attachment.body.toString('utf8')) as Event;
      attempt.events.push(event);
      if (event.phase === 'acquisition' && event.status === 'started') {
        attempt.acquisitionStartedAt = performance.now();
      }
      if (event.phase === 'acquisition' && event.status === 'completed') {
        attempt.acquisitionCompletedAt = performance.now();
      }
      if (event.phase === 'sandbox' && event.status === 'completed') {
        attempt.sandboxId = event.detail.split(';')[0];
      }
      if (event.phase === 'acquisition' && attempt.businessSteps > 0) {
        attempt.errors.push('Acquisition event was delivered after business execution started');
      }
    }
  }

  onTestEnd(_test: TestCase, result: TestResult): void {
    const attempt = this.attempts.get(result);
    if (attempt === undefined) {
      return;
    }
    for (const phase of [
      'catalog',
      'acquisition',
      'instrumentation',
      'readiness',
      'sandbox',
      'teardown',
      'collector',
    ]) {
      if (!attempt.events.some((event) => event.phase === phase && event.status === 'completed')) {
        attempt.errors.push(`Missing live completion: ${phase}`);
      }
    }
    if (attempt.businessSteps < 3) {
      attempt.errors.push('Missing business steps');
    }
  }

  async onEnd(): Promise<{ status: FullResult['status'] } | undefined> {
    const attempts = [...this.attempts.values()];
    const errors = attempts.flatMap(({ title, errors }) =>
      errors.map((error) => `${title}: ${error}`),
    );
    if (attempts.length !== 8) {
      errors.push(`Expected 8 attempts, received ${attempts.length}`);
    }
    if (!attempts.some(({ nestedSteps }) => nestedSteps > 0)) {
      errors.push('No nested business steps');
    }
    await writeFile(
      join(import.meta.dirname, '../test-results/live-reporting.json'),
      JSON.stringify({ attempts, errors }, null, 2),
    );
    if (errors.length > 0) {
      return { status: 'failed' };
    }
    return undefined;
  }
}
