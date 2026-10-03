import type { TestInfo } from '@playwright/test';
import { expect as check, it } from 'vitest';

import { AttemptReport } from '../reporting/attempt.js';
import type { EffectContractBuilder } from './contract.js';
import type { EffectEvidenceArtifact } from './evaluation/artifact-types.js';
import { expect } from './expect.js';
import {
  bindEffectAssertionReporter,
  createBlackboxEffects,
  retainEffectEvidence,
  type EffectEvaluation,
} from './runtime.js';

function evidence(): EffectEvidenceArtifact {
  return {
    kind: 'admitted',
    observations: {
      scopeId: 'scope-1',
      payloadCount: 1,
      diagnostics: ['token=synthetic-secret'],
      excerpts: [
        {
          traceId: '1'.repeat(32),
          spanId: '2'.repeat(16),
          service: 'p'.repeat(1200),
          kind: '3',
          status: '1',
          fields: [{ key: 'http.route', value: '/synthetic-secret' }],
        },
      ],
    },
    selection: {
      scopeId: 'scope-1',
      sessionId: 'session-1',
      executionId: 'execution-1',
      kind: 'stimulus',
      activities: [],
    },
    projection: {
      schemaVersion: '0.1.1',
      scope: { id: 'scope-1', closed: false },
      quality: {
        coverage: 'unknown',
        orderCoverage: 'unknown',
        reasons: ['no completeness'],
        attestation: 'none',
      },
      effects: [],
      relations: [],
    },
    assessment: {
      status: 'pass',
      scope: 'scope-1',
      semanticsVersion: '0.1.0',
      findings: [],
    },
    ownership: [],
    omitted: {
      activities: 0,
      activityTraces: 0,
      diagnostics: 0,
      observations: 0,
      effects: 0,
      effectSources: 0,
      relations: 0,
      qualityReasons: 0,
      findings: 0,
      findingEvidence: 0,
      ownership: 0,
      owners: 0,
    },
  };
}

it('attaches each final positive, negative, failed, and inconclusive assertion decision', async () => {
  const attachments: { readonly name: string; readonly body: string }[] = [];
  const testInfo = {
    attach: (name: string, options: { readonly body: string }) => {
      attachments.push({ name, body: options.body });
      return Promise.resolve();
    },
  } as TestInfo;
  const reporter = new AttemptReport(testInfo);
  reporter.protect({ token: 'synthetic-secret' });
  const admittedDecisions = [
    { kind: 'satisfied' },
    { kind: 'unsatisfied', message: 'missing effect' },
    { kind: 'unsatisfied', message: 'missing effect' },
  ] satisfies EffectEvaluation[];
  const decisions = [
    ...admittedDecisions.map((evaluation) => retainEffectEvidence(evaluation, evidence())),
    { kind: 'inconclusive', message: 'No completed stimulus activity is available.' },
    { kind: 'inconclusive', message: 'No completed stimulus activity is available.' },
  ] satisfies EffectEvaluation[];
  const effects = createBlackboxEffects({
    sessionId: 'session-1',
    executionId: 'execution-1',
    evaluator: {
      evaluate: () => Promise.resolve(decisions.shift() ?? { kind: 'satisfied' }),
    },
  });
  bindEffectAssertionReporter(effects, reporter);
  const contract: EffectContractBuilder = (fx) => [
    fx.exists(fx.http({ method: 'POST', route: '/payments' })),
    fx.absent(fx.db({ operation: 'DELETE', table: 'payments' })),
  ];

  await expect(effects).toSatisfy(contract);
  await check(expect(effects).toSatisfy(contract)).rejects.toThrow('missing effect');
  await expect(effects).not.toSatisfy(contract);
  await check(expect(effects).toSatisfy(contract)).rejects.toThrow('No completed stimulus');
  await check(expect(effects).not.toSatisfy(contract)).rejects.toThrow('No completed stimulus');

  check(attachments.map(({ name }) => name)).toEqual(Array(5).fill('blackbox-effects'));
  const documents = attachments.map(({ body }) => JSON.parse(body) as Record<string, unknown>);
  check(documents.map(({ assertion }) => assertion)).toEqual([
    check.objectContaining({ sequence: 1, negated: false, outcome: 'passed' }),
    check.objectContaining({ sequence: 2, negated: false, outcome: 'failed' }),
    check.objectContaining({ sequence: 3, negated: true, outcome: 'passed' }),
    check.objectContaining({ sequence: 4, negated: false, outcome: 'inconclusive' }),
    check.objectContaining({ sequence: 5, negated: true, outcome: 'inconclusive' }),
  ]);
  check(attachments.map(({ body }) => body).join('\n')).not.toContain('synthetic-secret');
  const inconclusiveAttachment = attachments.at(3);
  check(inconclusiveAttachment).toBeDefined();
  if (inconclusiveAttachment === undefined) {
    throw new Error('Expected an inconclusive attachment');
  }
  check(inconclusiveAttachment.body).toContain('No completed stimulus activity');
  check(documents.at(0)).toMatchObject({ display: { stringLimit: 1000, truncatedStrings: 1 } });
  check(documents.at(3)).toMatchObject({ evidence: { kind: 'not-admitted' } });
  check(documents.at(0)).toMatchObject({
    assertion: {
      contract: {
        schemaVersion: 1,
        constraints: [
          {
            operator: 'atLeast',
            count: 1,
            selector: { kind: 'http', operation: 'POST', target: '/payments' },
          },
          {
            operator: 'exactly',
            count: 0,
            selector: { kind: 'db', operation: 'DELETE', target: 'payments' },
          },
        ],
        omitted: { constraints: 0, selectorWhereEntries: 0 },
      },
    },
  });
});
