import type { BlackboxEffects } from '../../types.js';
import { captureAttemptActivity } from '../../effects/attempt-effects.js';
import { bindCapturedEffects, effectAssertionReporter } from '../../effects/runtime.js';
import type { EffectCapture } from '@suites/blackbox-effects';
import type { AttemptReport } from '../../reporting/attempt.js';
import type { ExecutionEvent, ExecutionJournal } from './journal.js';
import { outputCapture } from './output.js';
import { durableEvents } from './durable-events.js';
import { boundedEffectGraph } from '../capture/effects.js';
import type { APIRequestContext } from '@playwright/test';

export function durableExecution(input: {
  readonly effects: BlackboxEffects;
  readonly request: APIRequestContext;
}) {
  const reporter = effectAssertionReporter(input.effects);
  if (reporter === undefined) { throw new Error('Blackbox execution reporting is unavailable'); }
  const report = reporter as AttemptReport;
  const output = outputCapture(input.request, (text) => report.redact(text));
  const actions = new Map<string, Promise<PromiseSettledResult<unknown>>>();
  const artifacts = new Map<string, { output: unknown; effects: string | null }>();
  return {
    request: output.request,
    observe(event: ExecutionEvent): void {
      if (event.kind === 'begin' || event.kind === 'capture-failure') { report.markStimulus(); }
      if (event.kind === 'action' && event.status === 'completed') {
        actions.set(event.executionId, output.capture(event.output).then(
          (value) => ({ status: 'fulfilled' as const, value }),
          (reason: unknown) => ({ status: 'rejected' as const, reason }),
        ));
      }
    },
    async capture(cut: {
      readonly executionId: string;
      readonly activityId: string;
    }): Promise<EffectCapture> {
      const outputResult = actions.get(cut.executionId);
      if (outputResult === undefined) { throw new Error('Stimulus output capture was not started'); }
      const [result, [effectsResult]] = await Promise.all([
        outputResult,
        Promise.allSettled([
        captureAttemptActivity(input.effects, cut.activityId).then(async (captured) => {
          if (captured.graph === undefined) { throw new Error('Effects projection is unavailable'); }
          const reference = await report.executionArtifact('stimulus-effects', {
            schemaVersion: 1,
            kind: 'stimulus-effects',
            executionId: cut.executionId,
            identity: captured.capture.identity,
            coverage: captured.capture.coverage,
            evidence: captured.evidence,
            ...boundedEffectGraph(captured.graph),
          });
          return { reference, capture: bindCapturedEffects(input.effects, captured) };
        }),
        ]),
      ]);
      artifacts.set(cut.executionId, {
        output: result.status === 'fulfilled' ? result.value : { kind: 'capture-failed' },
        effects: effectsResult.status === 'fulfilled' ? effectsResult.value.reference : null,
      });
      const errors = [result, effectsResult].flatMap((item) =>
        item.status === 'rejected' ? [item.reason as unknown] : [],
      );
      if (errors.length > 0) {
        throw new AggregateError(errors, 'Blackbox execution capture failed');
      }
      if (effectsResult.status !== 'fulfilled') { throw new Error('Blackbox effects capture failed'); }
      return effectsResult.value.capture;
    },
    async finish(journal: ExecutionJournal): Promise<void> {
      for (const [executionId, pending] of actions) {
        if (!artifacts.has(executionId)) {
          const result = await pending;
          artifacts.set(executionId, { output: result.status === 'fulfilled' ? result.value : { kind: 'capture-failed' }, effects: null });
        }
      }
      const events = durableEvents(journal, report, artifacts);
      await report.executionArtifact('execution-evidence', {
        schemaVersion: 1,
        kind: 'stimulus-executions',
        sessionId: input.effects.sessionId,
        attemptExecutionId: input.effects.executionId,
        events,
        artifacts: [...artifacts].map(([executionId, value]) => ({ executionId, ...value })),
      });
    },
  };
}
