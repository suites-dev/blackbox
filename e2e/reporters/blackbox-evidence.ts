import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  FullResult,
  Reporter,
  Suite,
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

function entrypointFile(test: TestCase): string {
  let suite: Suite | undefined = test.parent;
  while (suite !== undefined && suite.type !== 'file') {
    suite = suite.parent;
  }
  if (suite === undefined) {
    throw new Error(`Missing native file suite for ${test.title}`);
  }
  return suite.title;
}

function isEffectsSource(file: string): boolean {
  return /[/\\]effects-acceptance(?:\.spec|-(?:browser|database|messaging))\.ts$/u.test(file);
}

/** Acceptance oracle: observe worker events before the test result is finalized. */
export default class BlackboxEvidence implements Reporter {
  private readonly attempts = new Map<
    TestResult,
    {
      title: string;
      file: string;
      sourceFile: string;
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
      effectsAssertions: number;
      errors: string[];
    }
  >();

  printsToStdio(): boolean {
    return false;
  }

  onTestBegin(test: TestCase, result: TestResult): void {
    this.attempts.set(result, {
      title: test.title,
      file: entrypointFile(test),
      sourceFile: test.location.file,
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
      effectsAssertions: 0,
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
    attempt.effectsAssertions = result.attachments.filter(
      (attachment) => attachment.name === 'blackbox-effects',
    ).length;
    if (isEffectsSource(attempt.sourceFile) && attempt.effectsAssertions === 0) {
      attempt.errors.push('Missing live effects assertion evidence');
    }
    if (!isEffectsSource(attempt.sourceFile) && attempt.businessSteps < 3) {
      attempt.errors.push('Missing business steps');
    }
  }

  async onEnd(): Promise<{ status: FullResult['status'] } | undefined> {
    const attempts = [...this.attempts.values()];
    const errors = attempts.flatMap(({ title, errors }) =>
      errors.map((error) => `${title}: ${error}`),
    );
    if (attempts.length !== 18) {
      errors.push(`Expected 18 attempts, received ${attempts.length}`);
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
