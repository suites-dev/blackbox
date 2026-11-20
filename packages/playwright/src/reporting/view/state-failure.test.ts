import type { TestCase, TestResult } from '@playwright/test/reporter';
import { expect, it } from 'vitest';

import { digestBytes } from '../../envelope/index.js';
import { buildAttemptView } from './model.js';

type FailureLocation = 'initial' | 'final' | 'diff' | 'reader-without-count' | 'count-only'
  | 'count-missing' | 'count-malformed';

function attemptWithFailedState(location: FailureLocation, claimStatus: 'passed' | 'failed' = 'passed') {
  const effects = Buffer.from(JSON.stringify({
    schemaVersion: 1, kind: 'stimulus-effects', executionId: 'successful',
    identity: { captureId: 'initial' }, coverage: { coverage: 'unknown', closed: false },
    graph: { effects: [], relations: [] },
  }));
  const healthy = { version: 1, checkpointId: 'healthy', failureCount: 0, observers: [] };
  const failed = { version: 1, checkpointId: 'failed', failureCount: 1,
    observers: [{ name: 'payments', readers: [{ name: 'rows', status: 'failed' }] }] };
  const missingCount = { version: 1, checkpointId: 'failed',
    observers: [{ name: 'payments', readers: [{ name: 'rows', status: 'failed' }] }] };
  const countOnly = { version: 1, checkpointId: 'failed', failureCount: 1, observers: [] };
  const countMissing = { version: 1, checkpointId: 'failed', observers: [] };
  const countMalformed = { version: 1, checkpointId: 'failed', failureCount: 'invalid', observers: [] };
  const final = location === 'final' ? failed : location === 'reader-without-count' ? missingCount
    : location === 'count-only' ? countOnly : location === 'count-missing' ? countMissing
      : location === 'count-malformed' ? countMalformed : healthy;
  const diff = { version: 1, initialCheckpointId: 'healthy', finalCheckpointId: 'failed',
    observers: [{ name: 'payments', status: location === 'diff' ? 'failed' : 'captured', diff: {} }] };
  const events = Array<Record<string, unknown>>(
    { kind: 'begin', executionId: 'successful', title: 'When a payment is accepted', initial: healthy },
    { kind: 'action', executionId: 'successful', status: 'completed' },
    { kind: 'final', executionId: 'successful', final: healthy,
      diff: { version: 1, observers: [{ name: 'payments', status: 'captured', diff: {} }] } },
    { kind: 'claim', executionId: 'successful', title: 'Then it is accepted', status: claimStatus, evidence: [] },
    { kind: 'begin', executionId: 'failed', title: 'When another payment is accepted',
      initial: location === 'initial' ? failed : healthy },
  );
  if (location === 'initial') {
    events.push({ kind: 'action', executionId: 'failed', status: 'not-executed' });
  } else {
    events.push({ kind: 'action', executionId: 'failed', status: 'completed' });
    events.push({ kind: 'final', executionId: 'failed', final, diff });
  }
  const execution = Buffer.from(JSON.stringify({
    schemaVersion: 1, kind: 'stimulus-executions', events,
    artifacts: [{ executionId: 'successful', effects: digestBytes(effects),
      output: { kind: 'response', status: 201, headers: {}, body: { id: 'first' } } }],
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
    errors: [{ message: 'Blackbox state capture failed' }],
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

it.each(['initial', 'final', 'diff', 'reader-without-count', 'count-only'] as const)(
  'does not verify a passed claim when %s state records a failure', (location) => {
    const view = attemptWithFailedState(location);
    expect(view.evidence).toMatchObject({ status: 'partial', captureHealth: { status: 'captured' } });
    expect(view.verification).toMatchObject({ status: 'unavailable', passed: 1, failed: 0 });
    expect(view.evidence.problems).toContain('State checkpoint or comparison records failed readers');
  },
);

it.each(['count-missing', 'count-malformed'] as const)(
  'does not verify a passed claim with a %s on a v1 checkpoint', (location) => {
    const view = attemptWithFailedState(location);
    expect(view.evidence.status).toBe('partial');
    expect(view.verification).toMatchObject({ status: 'unavailable', passed: 1, failed: 0 });
    expect(view.evidence.problems).toContain('State checkpoint has an invalid failure count');
  },
);

it('preserves failed-claim precedence when another execution has failed state', () => {
  const view = attemptWithFailedState('final', 'failed');
  expect(view.evidence.status).toBe('partial');
  expect(view.verification).toMatchObject({ status: 'failed', passed: 0, failed: 1 });
  expect(view.evidence.problems).toContain('State checkpoint or comparison records failed readers');
});
