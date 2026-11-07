import type { TestInfo } from '@playwright/test';
import { assessEffectRecorder, createEffectCapture } from '@suites/blackbox-effects';
import { expect, it, vi } from 'vitest';
import type { EmissionAssertionReport } from '../../../effects/emissions/types.js';
import { completeGraph } from '../../../effects/testing/emissions.fixture.js';
import { AttemptReport } from '../../attempt.js';

function reportWithAttachment(attach: TestInfo['attach']): AttemptReport {
  const fields = { attach } satisfies Partial<TestInfo>;
  return new AttemptReport(fields as TestInfo);
}

function emission(): EmissionAssertionReport {
  const graph = completeGraph([]);
  const capture = createEffectCapture({ graph, identity: {
    sessionId: 'session', executionId: 'execution', captureId: 'capture', scopeId: graph.scope.id, activityIds: ['activity'],
  } });
  return { matcher: 'toHaveEmitted', expected: '', negated: false,
    assessment: assessEffectRecorder(capture.http({}), { operator: 'atLeast', count: 1 }),
    evidence: null, witnesses: [], otherCapture: null };
}

it('refuses a revoked emission attachment before it starts', async () => {
  const controller = new AbortController();
  controller.abort(new Error('capture revoked'));
  const attach = vi.fn(() => Promise.resolve());
  const report = reportWithAttachment(attach);
  await expect(report.emissionAssertion(emission(), {
    signal: controller.signal, check: () => { controller.signal.throwIfAborted(); },
  })).rejects.toThrow('capture revoked');
  expect(attach).not.toHaveBeenCalled();
  expect(report.attachedEvidence()).toEqual([]);
});

it('does not register an emission when cancellation occurs during an already started attachment', async () => {
  const controller = new AbortController();
  let release!: () => void;
  const attaching = new Promise<void>((resolve) => { release = resolve; });
  const report = reportWithAttachment(() => attaching);
  const pending = report.emissionAssertion(emission(), {
    signal: controller.signal, check: () => { controller.signal.throwIfAborted(); },
  });
  controller.abort(new Error('capture revoked'));
  const rejected = expect(pending).rejects.toThrow('capture revoked');
  release();
  await rejected;
  expect(report.attachedEvidence()).toEqual([]);
});
