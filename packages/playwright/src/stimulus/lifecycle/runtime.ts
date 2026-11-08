import { randomUUID } from 'node:crypto';
import { close, createContext, ensureActive, prefix, type LifecycleInput } from './context.js';
import { action, capture, checkCapture, effectCut, precondition } from './phases.js';
import { createVerification } from './verification.js';
import type { ExecutionEvidence, Stimulus } from './types.js';

export function createStimulusLifecycle(input: LifecycleInput) {
  const context = createContext(input);
  const stimulus: Stimulus = async (title, callback, options) => {
    prefix(title, ['When']);
    const condition = options === undefined ? undefined : options.precondition;
    if (condition !== undefined) { prefix(condition.name, ['Given']); }
    ensureActive(context);
    if (context.running) { throw new Error('Overlapping Blackbox stimuli are not supported'); }
    context.running = true;
    const executionId = randomUUID();
    let started = false;
    try {
      const selection = input.registry.select();
      const initial = await capture(context, executionId, selection, { title, phase: 'initial' });
      context.journal.append({ kind: 'begin', executionId, title, selection, initial });
      checkCapture(context, initial, 'initial');
      if (condition !== undefined) { await precondition(context, executionId, selection, { initial, condition }); }
      ensureActive(context);
      started = true;
      const completed = await action(context, executionId, title, callback);
      const final = await capture(context, executionId, selection, { title, phase: 'final' });
      context.journal.append({ kind: 'final', executionId, final });
      checkCapture(context, final, 'final');
      const effects = await effectCut(context, executionId, completed.activityId);
      const evidence = { state: (observer) => selection.between(initial.checkpoint, final.checkpoint, observer), ...(effects === undefined ? {} : { effects }) } satisfies ExecutionEvidence;
      return { result: completed.result, evidence: Object.freeze(evidence), verify: createVerification(context, executionId) };
    } catch (error) {
      if (context.active && !started) { context.journal.append({ kind: 'action', executionId, status: 'not-executed' }); }
      throw error;
    } finally { context.running = false; }
  };
  return { stimulus, journal: context.journal, close: () => { close(context); } };
}
