import type { TestCase, TestResult } from '@playwright/test/reporter';
import { expect, it } from 'vitest';

import { digestBytes } from '../../../envelope/index.js';
import { buildAttemptView } from '../model.js';

type Defect = 'complete' | 'no-artifact' | 'missing-effects' | 'missing-output' | 'capture-failed-output'
  | 'response-missing-headers' | 'response-missing-body';

function attemptWithArtifact(defect: Defect, claimStatus: 'passed' | 'failed' = 'passed') {
  const checkpoint = { version: 1, checkpointId: 'healthy', failureCount: 0, observers: [] };
  const effects = ['successful', 'other'].map((executionId) => Buffer.from(JSON.stringify({
    schemaVersion: 1, kind: 'stimulus-effects', executionId,
    identity: { captureId: `${executionId}-initial` },
    coverage: { coverage: 'unknown', closed: false }, graph: { effects: [], relations: [] },
  })));
  const events = ['successful', 'other'].flatMap((executionId) => [
    { kind: 'begin', executionId, title: `When ${executionId} payment is accepted`, initial: checkpoint },
    { kind: 'action', executionId, status: 'completed' },
    { kind: 'final', executionId, final: checkpoint, diff: { version: 1, observers: [] } },
    ...(executionId === 'successful' ? [
      { kind: 'claim', executionId, title: 'Then it is accepted', status: claimStatus, evidence: [] },
    ] : []),
  ]);
  const artifacts = [
    { executionId: 'successful', effects: digestBytes(effects[0]),
      output: { kind: 'response', status: 201, headers: {}, body: { id: 'first' } } },
    ...(defect === 'no-artifact' ? [] : [{
      executionId: 'other',
      ...(defect === 'missing-effects' ? {} : { effects: digestBytes(effects[1]) }),
      ...(defect === 'missing-output' ? {} : {
        output: defect === 'capture-failed-output' ? { kind: 'capture-failed' }
          : defect === 'response-missing-headers' ? { kind: 'response', status: 201, body: { id: 'second' } }
            : defect === 'response-missing-body' ? { kind: 'response', status: 201, headers: {} }
              : { kind: 'json', value: null },
      }),
    }]),
  ];
  const execution = Buffer.from(JSON.stringify({ schemaVersion: 1, kind: 'stimulus-executions', events, artifacts }));
  const test = {
    id: 'payment-contract', title: 'Scenario: two payments', expectedStatus: 'passed',
    titlePath: () => ['Rule: payments', 'Scenario: two payments'],
    location: { file: 'payments.spec.ts', line: 1, column: 1 },
    parent: { project: () => ({ name: 'payment-system', outputDir: '/tmp' }) },
  } as TestCase;
  const result = {
    status: 'passed', retry: 0, workerIndex: 0, parallelIndex: 0, duration: 1,
    startTime: new Date(), annotations: [], stderr: [], stdout: [], steps: [], errors: [],
    attachments: [
      { name: 'blackbox-execution', contentType: 'application/json', body: execution },
      ...effects.map((body) => ({ name: 'effects.json', contentType: 'application/json', body })),
      { name: 'blackbox-capture-health', contentType: 'application/json', body: Buffer.from(JSON.stringify({
        schemaVersion: 1, kind: 'capture-health', status: 'captured',
      })) },
    ],
  } as TestResult;
  return buildAttemptView(test, result);
}

it('verifies a complete execution and keeps a captured null JSON output valid', () => {
  const view = attemptWithArtifact('complete');
  expect(view.evidence.status).toBe('available');
  expect(view.verification).toMatchObject({ status: 'verified', passed: 1 });
  expect(view.executions[1].output).toEqual({ kind: 'json', value: null });
});

it.each(['no-artifact', 'missing-effects', 'missing-output', 'capture-failed-output',
  'response-missing-headers', 'response-missing-body'] as const)(
  'does not verify a passed claim when another completed execution has %s', (defect) => {
    const view = attemptWithArtifact(defect);
    expect(view.evidence).toMatchObject({ status: 'partial', captureHealth: { status: 'captured' } });
    expect(view.verification).toMatchObject({ status: 'unavailable', passed: 1, failed: 0 });
    expect(view.evidence.problems).toContain('Completed execution artifact is missing or invalid');
  },
);

it('keeps failed-claim precedence when another completed execution lacks effects', () => {
  const view = attemptWithArtifact('missing-effects', 'failed');
  expect(view.evidence.status).toBe('partial');
  expect(view.verification).toMatchObject({ status: 'failed', passed: 0, failed: 1 });
});
