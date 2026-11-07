import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { APIRequestContext, TestInfo } from '@playwright/test';
import { createEffectCapture } from '@suites/blackbox-effects';
import { expect, it, vi } from 'vitest';
import { captureAttemptActivity } from '../../../effects/attempt-effects.js';
import { bindEffectAssertionReporter, createBlackboxEffects } from '../../../effects/runtime.js';
import { completeGraph } from '../../../effects/testing/emissions.fixture.js';
import { AttemptReport } from '../../../reporting/attempt.js';
import { createExecutionJournal, type ExecutionEvent } from '../journal.js';
import { durableExecution } from '../durable.js';

vi.mock('../../../effects/attempt-effects.js', () => ({ captureAttemptActivity: vi.fn() }));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((ready) => { resolve = ready; });
  return { promise, resolve };
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-durable-close-'));
  const attachments: { name: string; body: string }[] = [];
  const report = new AttemptReport({
    outputPath: (...parts: string[]) => join(directory, ...parts),
    attach: (name: string, { body }: { body: string }) => { attachments.push({ name, body }); return Promise.resolve(); },
  } as TestInfo);
  const effects = createBlackboxEffects({ sessionId: 'session', executionId: 'attempt',
    evaluator: { evaluate: () => Promise.resolve({ kind: 'satisfied' }) } });
  bindEffectAssertionReporter(effects, report);
  const graph = completeGraph([]);
  const captured = { graph, evidence: null, capture: createEffectCapture({ graph,
    identity: { sessionId: 'session', executionId: 'attempt', captureId: 'capture', scopeId: graph.scope.id, activityIds: ['activity'] } }) };
  const durable = durableExecution({ effects, request: {} as APIRequestContext, captureTimeoutMs: 100 });
  const journal = createExecutionJournal();
  const action = { kind: 'action', executionId: 'execution', status: 'completed', activityId: 'activity', output: { value: 'observed' } } satisfies ExecutionEvent;
  journal.append(action);
  durable.observe(action);
  await new Promise<void>((resolve) => { setImmediate(resolve); });
  return { directory, attachments, report, captured, durable, journal };
}

async function assertInterruptedEvidence(context: Awaited<ReturnType<typeof fixture>>) {
  expect(context.attachments.map(({ name }) => name)).toEqual(['blackbox-execution']);
  expect(JSON.parse(context.attachments[0].body)).toMatchObject({ artifacts: [
    { executionId: 'execution', effects: null, output: { kind: 'json', value: { value: 'observed' } } },
  ] });
  expect(context.report.attachedEvidence().map(({ kind }) => kind)).toEqual(['execution-evidence']);
  await expect(readFile(join(context.directory, 'blackbox/execution-evidence/1/effects.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(() => { context.durable.operations.check(); }).toThrow('closed');
}

it('drains a cancelled activity read before finalization and refuses its late artifact', async () => {
  const context = await fixture();
  const entered = deferred();
  const release = deferred();
  vi.mocked(captureAttemptActivity).mockImplementationOnce(async () => {
    entered.resolve(); await release.promise; return context.captured;
  });
  try {
    const pending = context.durable.capture({ executionId: 'execution', activityId: 'activity' });
    const interrupted = expect(pending).rejects.toThrow('interrupted');
    await entered.promise;
    const closing = expect(context.durable.finish(context.journal)).rejects.toThrow('execution capture failed');
    release.resolve();
    await Promise.all([interrupted, closing]);
    await assertInterruptedEvidence(context);
  } finally { release.resolve(); await rm(context.directory, { recursive: true, force: true }); }
});

it('waits for a pending artifact operation and prevents attachment when its lease was revoked', async () => {
  const context = await fixture();
  const entered = deferred();
  const release = deferred();
  vi.mocked(captureAttemptActivity).mockResolvedValueOnce(context.captured);
  const original = context.report.executionArtifact.bind(context.report);
  context.report.executionArtifact = async (kind, value, lease) => {
    if (kind === 'stimulus-effects') { entered.resolve(); await release.promise; }
    return original(kind, value, lease);
  };
  try {
    const pending = context.durable.capture({ executionId: 'execution', activityId: 'activity' });
    const interrupted = expect(pending).rejects.toThrow('interrupted');
    await entered.promise;
    const closing = expect(context.durable.finish(context.journal)).rejects.toThrow('execution capture failed');
    await Promise.resolve();
    expect(context.attachments).toEqual([]);
    release.resolve();
    await Promise.all([interrupted, closing]);
    await assertInterruptedEvidence(context);
  } finally { release.resolve(); await rm(context.directory, { recursive: true, force: true }); }
});

it('bounds terminal execution persistence and prevents its delayed attachment after the deadline', async () => {
  const context = await fixture();
  const entered = deferred();
  const release = deferred();
  const original = context.report.executionArtifact.bind(context.report);
  context.report.executionArtifact = async (kind, value, lease) => {
    entered.resolve(); await release.promise;
    return original(kind, value, lease);
  };
  vi.useFakeTimers();
  try {
    let finished = false;
    const result = context.durable.finish(context.journal).then(() => null, (error: unknown) => error)
      .then((outcome) => { finished = true; return outcome; });
    await entered.promise;
    await vi.advanceTimersByTimeAsync(200);
    expect(finished).toBe(true);
    expect(await result).toMatchObject({ message: 'Blackbox execution capture failed' });
    expect(context.attachments).toEqual([]);
    release.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(context.attachments).toEqual([]);
    expect(context.report.attachedEvidence()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  } finally { release.resolve(); vi.useRealTimers(); await rm(context.directory, { recursive: true, force: true }); }
});
