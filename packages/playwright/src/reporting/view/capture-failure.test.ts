import type { TestCase, TestResult } from '@playwright/test/reporter';
import { expect, it } from 'vitest';

import { digestBytes } from '../../envelope/index.js';
import { buildAttemptView } from './model.js';

function failedCaptureAfterClaim(claimStatus: 'passed' | 'failed') {
  const effects = Buffer.from(JSON.stringify({
    schemaVersion: 1, kind: 'stimulus-effects', executionId: 'successful',
    identity: { captureId: 'initial' }, coverage: { coverage: 'unknown', closed: false },
    graph: { effects: [], relations: [] },
  }));
  const execution = Buffer.from(JSON.stringify({
    schemaVersion: 1, kind: 'stimulus-executions',
    events: [
      { kind: 'begin', executionId: 'successful', title: 'When a subscription is created' },
      { kind: 'claim', executionId: 'successful', title: 'Then it is retained', status: claimStatus, evidence: [] },
      { kind: 'capture-failure', executionId: 'failed', phase: 'initial', error: 'initial capture interrupted' },
    ],
    artifacts: [{ executionId: 'successful', effects: digestBytes(effects), output: { kind: 'response', status: 201 } }],
  }));
  const test = {
    id: 'subscription-contract', title: 'Scenario: a subscription is created', expectedStatus: 'passed',
    titlePath: () => ['Rule: subscriptions', 'Scenario: a subscription is created'],
    location: { file: 'subscriptions.spec.ts', line: 1, column: 1 },
    parent: { project: () => ({ name: 'payment-system', outputDir: '/tmp' }) },
  } as TestCase;
  const result = {
    status: 'failed', retry: 0, workerIndex: 0, parallelIndex: 0, duration: 1,
    startTime: new Date(), annotations: [], stderr: [], stdout: [], steps: [],
    errors: [{ message: 'initial capture interrupted' }],
    attachments: [
      { name: 'blackbox-execution', contentType: 'application/json', body: execution },
      { name: 'effects.json', contentType: 'application/json', body: effects },
      { name: 'blackbox-capture-health', contentType: 'application/json', body: Buffer.from(JSON.stringify({
        schemaVersion: 1, kind: 'capture-health', status: 'captured',
      })) },
    ],
  } as TestResult;
  return buildAttemptView(test, result);
}

it('marks an execution capture failure partial despite another passed claim and healthy collector', () => {
  const view = failedCaptureAfterClaim('passed');
  expect(view.evidence).toMatchObject({ status: 'partial', captureHealth: { status: 'captured' } });
  expect(view.verification).toMatchObject({ status: 'unavailable', passed: 1, failed: 0 });
  expect(view.evidence.problems).toContain('Execution capture failure was recorded');
  expect(view.executions[1].captureFailures).toMatchObject([
    { kind: 'capture-failure', title: 'initial', error: 'initial capture interrupted' },
  ]);
});

it('keeps failed-claim precedence when another execution records a capture failure', () => {
  const view = failedCaptureAfterClaim('failed');
  expect(view.evidence.status).toBe('partial');
  expect(view.verification).toMatchObject({ status: 'failed', passed: 0, failed: 1 });
  expect(view.evidence.problems).toContain('Execution capture failure was recorded');
});
