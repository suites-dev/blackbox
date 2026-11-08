import type { TestInfo } from '@playwright/test';
import { assessEffectRecorder, createEffectCapture } from '@suites/blackbox-effects';
import { expect, it } from 'vitest';
import { takeSnapshots, withClaim } from '../../../assertions/claims/context.js';
import { compileEffectContract } from '../../../effects/contract.js';
import type { EmissionAssertionReport } from '../../../effects/emissions/types.js';
import { completeGraph } from '../../../effects/testing/emissions.fixture.js';
import { digestBytes } from '../../../envelope/index.js';
import { AttemptReport } from '../../attempt.js';

function emission(): EmissionAssertionReport {
  const graph = completeGraph([]);
  const capture = createEffectCapture({ graph, identity: {
    sessionId: 'session', executionId: 'execution', captureId: 'capture', scopeId: graph.scope.id, activityIds: ['activity'],
  } });
  return { matcher: 'toHaveEmitted', expected: '', negated: false,
    assessment: assessEffectRecorder(capture.http({}), { operator: 'atLeast', count: 1 }),
    evidence: null, witnesses: [], otherCapture: null };
}

it('shares assertion sequences and preserves claim ownership across out-of-order effect and emission attachments', async () => {
  const pending: { name: string; body: string; release: () => void }[] = [];
  const fields = {
    attach: (name, { body } = {}) => {
      if (typeof body !== 'string') { throw new TypeError('Expected a JSON attachment body'); }
      return new Promise<void>((release) => { pending.push({ name, body, release }); });
    },
  } satisfies Partial<TestInfo>;
  const report = new AttemptReport(fields as TestInfo);
  const effectClaim = 'effect-evidence-owner';
  const emissionClaim = 'emission-evidence-owner';
  try {
    const effect = withClaim(effectClaim, () => report.effectAssertion({
      contract: compileEffectContract((fx) => [fx.exists(fx.http({ route: '/approved' }))]),
      evaluation: { kind: 'satisfied' }, evidence: null, negated: false,
    }));
    const emitted = withClaim(emissionClaim, () => report.emissionAssertion(emission()));
    expect(pending.map(({ name }) => name)).toEqual(['blackbox-effects', 'blackbox-emissions']);
    expect(pending.map(({ body }) => (JSON.parse(body) as { assertion: { sequence: number } }).assertion.sequence)).toEqual([1, 2]);
    expect(report.attachedEvidence()).toEqual([]);
    expect(report.evidenceForClaim(effectClaim)).toEqual([]);
    expect(report.evidenceForClaim(emissionClaim)).toEqual([]);
    pending[1].release();
    await emitted;
    expect(report.evidenceForClaim(effectClaim)).toEqual([]);
    expect(report.evidenceForClaim(emissionClaim)).toEqual([digestBytes(pending[1].body)]);
    pending[0].release();
    await effect;
    expect(report.evidenceForClaim(effectClaim)).toEqual([digestBytes(pending[0].body)]);
    expect(report.attachedEvidence()).toMatchObject([
      { name: 'blackbox-emissions', sequence: 2, digest: digestBytes(pending[1].body), outcome: 'failed', evaluation: 'fail', contractDigest: null },
      { name: 'blackbox-effects', sequence: 1, digest: digestBytes(pending[0].body), outcome: 'passed', evaluation: 'satisfied' },
    ]);
  } finally {
    for (const attachment of pending) { attachment.release(); }
    takeSnapshots(effectClaim);
    takeSnapshots(emissionClaim);
  }
});
