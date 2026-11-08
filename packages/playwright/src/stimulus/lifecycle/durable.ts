import type { APIRequestContext } from '@playwright/test';
import type { LazyEffectCapture } from '../../effects/emissions/lazy/types.js';
import type { BlackboxEffects } from '../../types.js';
import { captureAttemptActivity } from '../../effects/attempt-effects.js';
import { bindCapturedEffects, effectAssertionReporter } from '../../effects/runtime.js';
import type { AttemptReport } from '../../reporting/attempt.js';
import type { ExecutionEvent, ExecutionJournal } from './journal.js';
import { outputCapture } from './output.js';
import { durableEvents } from './durable-events.js';
import { boundedEffectGraph } from '../capture/effects.js';
import { createCaptureOperations, type CaptureLease, type CaptureOperations } from '../../capture/operations.js';
import { liveStimulusEffects, type StimulusCutReference } from '../capture/live-effects.js';

export const executionCaptureTimeoutMs = 5_000;

interface Cut { readonly executionId: string; readonly activityId: string }
interface ExecutionArtifacts { output: unknown; effects: string | null; effectCaptures: StimulusCutReference[] }
interface DurableContext {
  readonly effects: BlackboxEffects;
  readonly report: AttemptReport;
  readonly operations: CaptureOperations;
  readonly timeoutMs: number;
  readonly actions: Map<string, Promise<PromiseSettledResult<unknown>>>;
  readonly artifacts: Map<string, ExecutionArtifacts>;
}

async function captureEffects(context: DurableContext, cut: Cut, lease: CaptureLease) {
  const captured = await captureAttemptActivity(context.effects, cut.activityId);
  lease.check();
  if (captured.graph === undefined) { throw new Error('Effects projection is unavailable'); }
  const reference = await context.report.executionArtifact('stimulus-effects', {
    schemaVersion: 1,
    kind: 'stimulus-effects',
    executionId: cut.executionId,
    identity: captured.capture.identity,
    coverage: captured.capture.coverage,
    evidence: captured.evidence,
    ...boundedEffectGraph(captured.graph),
  }, lease);
  lease.check();
  return { reference, capture: bindCapturedEffects(context.effects, captured) };
}

function captureExecution(context: DurableContext, cut: Cut): Promise<LazyEffectCapture> {
  return context.operations.run(async (lease) => {
    const outputResult = context.actions.get(cut.executionId);
    if (outputResult === undefined) { throw new Error('Stimulus output capture was not started'); }
    const [result, [effectsResult]] = await Promise.all([
      outputResult,
      Promise.allSettled([captureEffects(context, cut, lease)]),
    ]);
    lease.check();
    const effectCaptures: StimulusCutReference[] = effectsResult.status === 'fulfilled' ? [{
      captureId: effectsResult.value.capture.identity.captureId,
      reference: effectsResult.value.reference, purpose: 'initial',
    }] : [];
    context.artifacts.set(cut.executionId, {
      output: result.status === 'fulfilled' ? result.value : { kind: 'capture-failed' },
      effects: effectsResult.status === 'fulfilled' ? effectsResult.value.reference : null,
      effectCaptures,
    });
    const errors = [result, effectsResult].flatMap((item) =>
      item.status === 'rejected' ? [item.reason as unknown] : [],
    );
    if (errors.length > 0) { throw new AggregateError(errors, 'Blackbox execution capture failed'); }
    if (effectsResult.status !== 'fulfilled') { throw new Error('Blackbox effects capture failed'); }
    return liveStimulusEffects({ effects: context.effects, report: context.report,
      operations: context.operations, ...cut, record: (reference) => { effectCaptures.push(reference); } });
  });
}

async function persistExecution(context: DurableContext, journal: ExecutionJournal): Promise<void> {
  const terminal = createCaptureOperations({ timeoutMs: context.timeoutMs });
  const persisted = await Promise.allSettled([terminal.run((lease) =>
    context.report.executionArtifact('execution-evidence', {
      schemaVersion: 1,
      kind: 'stimulus-executions',
      sessionId: context.effects.sessionId,
      attemptExecutionId: context.effects.executionId,
      events: durableEvents(journal, context.report, context.artifacts),
      artifacts: [...context.artifacts].map(([executionId, value]) => ({ executionId, ...value })),
    }, lease), { timeoutMs: context.timeoutMs })]);
  const drained = await Promise.allSettled([terminal.close()]);
  const failures = [...persisted, ...drained].flatMap((result) => result.status === 'rejected' ? [result.reason as unknown] : []);
  if (failures.length > 0) { throw new AggregateError(failures, 'Blackbox execution persistence failed'); }
}

async function finishExecution(context: DurableContext, journal: ExecutionJournal): Promise<void> {
  const failures: unknown[] = [];
  try { await context.operations.close(); } catch (error) { failures.push(error); }
  for (const [executionId, pending] of context.actions) {
    if (!context.artifacts.has(executionId)) {
      const result = await pending;
      context.artifacts.set(executionId, { output: result.status === 'fulfilled' ? result.value : { kind: 'capture-failed' }, effects: null, effectCaptures: [] });
    }
  }
  try { await persistExecution(context, journal); } catch (error) { failures.push(error); }
  if (failures.length > 0) { throw new AggregateError(failures, 'Blackbox execution capture failed'); }
}

export function durableExecution(input: {
  readonly effects: BlackboxEffects;
  readonly request: APIRequestContext;
} & Readonly<Partial<{ captureTimeoutMs: number }>>) {
  const reporter = effectAssertionReporter(input.effects);
  if (reporter === undefined) { throw new Error('Blackbox execution reporting is unavailable'); }
  const report = reporter as AttemptReport;
  const timeoutMs = input.captureTimeoutMs ?? executionCaptureTimeoutMs;
  const operations = createCaptureOperations({ timeoutMs });
  const output = outputCapture(input.request, (text) => report.redact(text));
  const context = { effects: input.effects, report, operations, timeoutMs,
    actions: new Map<string, Promise<PromiseSettledResult<unknown>>>(),
    artifacts: new Map<string, ExecutionArtifacts>() } satisfies DurableContext;
  return {
    operations,
    request: output.request,
    observe(event: ExecutionEvent): void {
      operations.check();
      if (event.kind === 'begin' || event.kind === 'capture-failure') { report.markStimulus(); }
      if (event.kind === 'action' && event.status === 'completed') {
        context.actions.set(event.executionId, operations.run(async (lease) => {
          const captured = await output.capture(event.output);
          lease.check();
          return captured;
        }).then(
          (value) => ({ status: 'fulfilled' as const, value }),
          (reason: unknown) => ({ status: 'rejected' as const, reason }),
        ));
      }
    },
    capture: (cut: Cut) => captureExecution(context, cut),
    finish: (journal: ExecutionJournal) => finishExecution(context, journal),
  };
}
