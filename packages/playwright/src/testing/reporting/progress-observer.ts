import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Reporter, TestCase, TestResult, TestStep } from '@playwright/test/reporter';
import { decodeEvent, progressAttachment } from '../../reporting/events.js';

function lifecycleSteps(steps: readonly TestStep[]): TestStep[] {
  return steps.flatMap((step) => [
    ...(step.title === 'Start sandbox' || step.title === 'Clean up sandbox' ? [step] : []),
    ...lifecycleSteps(step.steps),
  ]);
}

/** Test-only handshake proves diagnostic attachments arrive during blocked setup. */
export default class ProgressObserver implements Reporter {
  printsToStdio(): boolean {
    return false;
  }

  onStepBegin(test: TestCase, result: TestResult, step: TestStep): void {
    if (step.title !== 'Start sandbox' && step.title !== 'Clean up sandbox') {
      return;
    }
    const parent = step.parent;
    appendFileSync(
      join(process.cwd(), 'native-step-events.jsonl'),
      `${JSON.stringify({
        phase: 'begin',
        testId: test.id,
        testTitle: test.title,
        retry: result.retry,
        title: step.title,
        observedAt: Date.now(),
        startTime: step.startTime.getTime(),
        parentTitle: parent === undefined ? null : parent.title,
        parentCategory: parent === undefined ? null : parent.category,
      })}\n`,
    );
    if (step.title === 'Start sandbox') {
      writeFileSync(join(process.cwd(), 'native-start-step-observed'), 'observed');
    }
  }

  onStepEnd(_test: TestCase, _result: TestResult, step: TestStep): void {
    if (step.title === 'Start sandbox' || step.title === 'Clean up sandbox') {
      appendFileSync(
        join(process.cwd(), 'native-step-events.jsonl'),
        `${JSON.stringify({
          phase: 'end',
          testId: _test.id,
          testTitle: _test.title,
          retry: _result.retry,
          title: step.title,
          error: step.error === undefined ? null : step.error.message,
          duration: step.duration,
          observedAt: Date.now(),
        })}\n`,
      );
    }
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

  onTestEnd(test: TestCase, result: TestResult): void {
    const lifecycle = lifecycleSteps(result.steps).map((step) => ({
      title: step.title,
      duration: step.duration,
      error: step.error === undefined ? null : step.error.message,
    }));
    appendFileSync(
      join(process.cwd(), 'native-step-events.jsonl'),
      `${JSON.stringify({
        phase: 'result',
        testId: test.id,
        testTitle: test.title,
        retry: result.retry,
        status: result.status,
        lifecycle,
      })}\n`,
    );
  }
}
