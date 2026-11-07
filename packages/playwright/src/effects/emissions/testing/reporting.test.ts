import { createEffectCapture } from '@suites/blackbox-effects';
import type { TestInfo } from '@playwright/test';
import { expect as check, it } from 'vitest';

import { AttemptReport } from '../../../reporting/attempt.js';
import { createEffectSnapshotArtifact } from '../../evaluation/artifact.js';
import { expect } from '../../expect.js';
import { bindEffectAssertionReporter, createBlackboxEffects } from '../../runtime.js';
import { completeGraph, emission, recordedEffects } from '../../testing/emissions.fixture.js';
import { serializeEffectSnapshot } from '../snapshot.js';

it('retains deciding witnesses beyond display limits and redacts verdicts in the attempt journal', async () => {
  const bodies: string[] = [];
  const reporter = new AttemptReport({
    attach: (_name: string, options: { body: string }) => { bodies.push(options.body); return Promise.resolve(); },
  } as TestInfo);
  reporter.protect({ token: 'protected-value' });
  const graph = completeGraph(Array.from({ length: 140 }, (_, index) => emission(String(index + 1),
    index === 139 ? '/protected-value' : '/payments')));
  const artifact = createEffectSnapshotArtifact({ graph, read: {
    kind: 'admitted', scopeId: graph.scope.id, payloads: [], diagnostics: [],
  } });
  const effects = createBlackboxEffects({
    sessionId: 'session', executionId: 'attempt',
    evaluator: { evaluate: () => Promise.resolve({ kind: 'satisfied' }) },
    capture: () => Promise.resolve({ evidence: artifact, capture: createEffectCapture({ graph, identity: {
      sessionId: 'session', executionId: 'attempt', scopeId: graph.scope.id,
      captureId: 'one-cut', activityIds: ['stimulus'],
    } }) }),
  });
  bindEffectAssertionReporter(effects, reporter);
  const selected = (await effects.capture()).http();
  await expect(selected).toHaveEmittedWith({ target: expect.stringContaining('protected-value') });
  await expect(selected).toHaveEmitted();
  check(bodies.join('\n')).not.toContain('protected-value');
  const first: unknown = JSON.parse(bodies[0]);
  check(first).toMatchObject({
    assertion: { matcher: 'toHaveEmittedWith', outcome: 'passed', evaluation: 'pass' },
    assessment: { evidence: ['140'], identity: { captureId: 'one-cut' } },
    witnesses: [{ id: '140', target: '/[REDACTED]' }],
    evidence: { omitted: { effects: 12 } },
  });
  const second: unknown = JSON.parse(bodies[1]);
  check(second).toMatchObject({ omitted: { evidence: 124, witnesses: 124 } });
  check(reporter.attachedEvidence()).toEqual([
    check.objectContaining({ name: 'blackbox-emissions', sequence: 1, outcome: 'passed', evaluation: 'pass', contractDigest: null }),
    check.objectContaining({ name: 'blackbox-emissions', sequence: 2, outcome: 'passed', evaluation: 'pass', contractDigest: null }),
  ]);
});

it('attaches unavailable capture decisions under both matcher polarities', async () => {
  const bodies: string[] = [];
  const reporter = new AttemptReport({
    attach: (_name: string, options: { body: string }) => { bodies.push(options.body); return Promise.resolve(); },
  } as TestInfo);
  const effects = createBlackboxEffects({ sessionId: 'session', executionId: 'attempt',
    evaluator: { evaluate: () => Promise.resolve({ kind: 'satisfied' }) } });
  bindEffectAssertionReporter(effects, reporter);
  const capture = await effects.capture();
  check(capture.available).toBe(false);
  await check(expect(capture.db()).toHaveEmitted()).rejects.toThrow(/inconclusive/);
  await check(expect(capture.db()).not.toHaveEmitted()).rejects.toThrow(/inconclusive/);
  check(bodies.map((body): unknown => JSON.parse(body))).toEqual([
    check.objectContaining({ assertion: check.objectContaining({ negated: false, outcome: 'inconclusive' }), evidence: { kind: 'not-admitted' } }),
    check.objectContaining({ assertion: check.objectContaining({ negated: true, outcome: 'inconclusive' }), evidence: { kind: 'not-admitted' } }),
  ]);
});

it('redacts configured secrets from YAML values while preserving quoting and syntax', async () => {
  for (const token of ['synthetic"\n\\:secret', ':']) {
    const reporter = new AttemptReport({} as TestInfo);
    reporter.protect({ token });
    const effects = recordedEffects(completeGraph([emission('1', `/private/${token}`)]));
    bindEffectAssertionReporter(effects, reporter);
    const recorder = (await effects.capture()).http();
    const yaml = serializeEffectSnapshot(recorder, { project: ({ target }) => ({ target }) });
    check(yaml).toContain('"target": "/private/[REDACTED]"');
    check(yaml).toContain('"schemaVersion": 1');
    check(yaml).not.toContain('synthetic');
  }
});

it('redacts configured secrets from failed matcher diagnostics and native matcher results', async () => {
  const attach: TestInfo['attach'] = () => Promise.resolve();
  const reporter = new AttemptReport({ attach } as TestInfo);
  reporter.protect({ token: 'diagnostic-secret' });
  const effects = recordedEffects(completeGraph([emission('1', '/diagnostic-secret')]));
  bindEffectAssertionReporter(effects, reporter);
  const recorder = (await effects.capture()).http();
  let failure: unknown;
  try {
    await expect(recorder).not.toHaveEmittedWith({ target: '/diagnostic-secret' });
  } catch (error) {
    failure = error;
  }
  check(failure).toBeInstanceOf(Error);
  check(String(failure)).not.toContain('diagnostic-secret');
  check(JSON.stringify(failure)).not.toContain('diagnostic-secret');
});
