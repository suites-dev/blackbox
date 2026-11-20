import type { TestCase, TestResult } from '@playwright/test/reporter';
import { expect, it } from 'vitest';

import { digestBytes } from '../../envelope/index.js';
import { buildAttemptView } from './model.js';

type Failure = 'precondition-failed' | 'precondition-interrupted' | 'action-failed' | 'action-interrupted'
  | 'missing-final' | 'missing-action' | 'missing-initial-object' | 'missing-final-object' | 'missing-diff-object';

function attemptWithIncompleteExecution(failure: Failure, claimStatus: 'passed' | 'failed' = 'passed') {
  const effects = Buffer.from(JSON.stringify({
    schemaVersion: 1, kind: 'stimulus-effects', executionId: 'successful',
    identity: { captureId: 'initial' }, coverage: { coverage: 'unknown', closed: false },
    graph: { effects: [], relations: [] },
  }));
  const checkpoint = { version: 1, checkpointId: 'healthy', failureCount: 0, observers: [] };
  const events = Array<Record<string, unknown>>(
    { kind: 'begin', executionId: 'successful', title: 'When a payment is accepted', initial: checkpoint },
    { kind: 'action', executionId: 'successful', status: 'completed' },
    { kind: 'final', executionId: 'successful', final: checkpoint, diff: { version: 1, observers: [] } },
    { kind: 'claim', executionId: 'successful', title: 'Then it is accepted', status: claimStatus, evidence: [] },
    { kind: 'begin', executionId: 'incomplete', title: 'When another payment is accepted',
      initial: failure === 'missing-initial-object' ? undefined : checkpoint },
  );
  if (failure.startsWith('precondition-')) {
    events.push({ kind: 'precondition', executionId: 'incomplete', title: 'Given the account is active',
      status: failure.slice('precondition-'.length) });
    events.push({ kind: 'action', executionId: 'incomplete', status: 'not-executed' });
  } else {
    if (failure !== 'missing-action') {
      events.push({ kind: 'action', executionId: 'incomplete',
        status: failure.startsWith('action-') ? failure.slice('action-'.length) : 'completed' });
    }
    if (failure === 'missing-action' || failure.endsWith('-object')) {
      events.push({ kind: 'final', executionId: 'incomplete',
        final: failure === 'missing-final-object' ? undefined : checkpoint,
        diff: failure === 'missing-diff-object' ? undefined : { version: 1, observers: [] } });
    }
  }
  const execution = Buffer.from(JSON.stringify({
    schemaVersion: 1, kind: 'stimulus-executions', events,
    artifacts: [{ executionId: 'successful', effects: digestBytes(effects), output: { status: 201 } }],
  }));
  const test = {
    id: 'payment-contract', title: 'Scenario: two payments', expectedStatus: 'passed',
    titlePath: () => ['Rule: payments', 'Scenario: two payments'],
    location: { file: 'payments.spec.ts', line: 1, column: 1 },
    parent: { project: () => ({ name: 'payment-system', outputDir: '/tmp' }) },
  } as TestCase;
  const result = {
    status: 'failed', retry: 0, workerIndex: 0, parallelIndex: 0, duration: 1,
    startTime: new Date(), annotations: [], stderr: [], stdout: [], steps: [],
    errors: [{ message: 'An execution did not complete' }],
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

it.each(['precondition-failed', 'precondition-interrupted', 'action-failed', 'action-interrupted', 'missing-final', 'missing-action'] as const)(
  'does not verify a passed claim after another execution has %s', (failure) => {
    const view = attemptWithIncompleteExecution(failure);
    expect(view.evidence).toMatchObject({ status: 'partial', captureHealth: { status: 'captured' } });
    expect(view.verification).toMatchObject({ status: 'unavailable', passed: 1, failed: 0 });
    expect(view.evidence.problems).toContain('Execution did not complete successfully');
  },
);

it.each(['missing-initial-object', 'missing-final-object', 'missing-diff-object'] as const)(
  'does not verify a passed claim when another execution has %s', (failure) => {
    const view = attemptWithIncompleteExecution(failure);
    expect(view.evidence.status).toBe('partial');
    expect(view.verification).toMatchObject({ status: 'unavailable', passed: 1, failed: 0 });
    expect(view.evidence.problems).toContain('Execution state evidence is missing or invalid');
  },
);

it('preserves failed-claim precedence with an unfinished execution', () => {
  const view = attemptWithIncompleteExecution('action-failed', 'failed');
  expect(view.evidence.status).toBe('partial');
  expect(view.verification).toMatchObject({ status: 'failed', passed: 0, failed: 1 });
  expect(view.evidence.problems).toContain('Execution did not complete successfully');
});
