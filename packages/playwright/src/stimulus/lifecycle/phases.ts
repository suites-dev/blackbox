import { assertionScope } from '../../assertions/scope.js';
import type { StateCapture, StateSelection } from '../../state/types.js';
import { ensureActive, type LifecycleContext } from './context.js';
import { failureStatus } from './verification.js';
import type { InitialState } from './types.js';
import type { EffectCapture } from '@suites/blackbox-effects';

export async function capture(context: LifecycleContext, executionId: string, selection: StateSelection, input: { readonly title: string; readonly phase: 'initial' | 'final' }): Promise<StateCapture> {
  const { title, phase } = input;
  context.pending.set(executionId, { title, phase });
  let value: StateCapture;
  try { value = await selection.capture(); }
  catch (error) { context.pending.delete(executionId); context.captureFailed = true; context.journal.append({ kind: 'capture-failure', executionId, phase, error }); throw error; }
  ensureActive(context);
  context.pending.delete(executionId);
  return value;
}
export function checkCapture(context: LifecycleContext, value: StateCapture, phase: 'initial' | 'final'): void {
  if (value.failures.length > 0) { context.captureFailed = true; throw new Error(`Blackbox ${phase} state capture failed`); }
}
export async function precondition(context: LifecycleContext, executionId: string, selection: StateSelection, input: { readonly initial: StateCapture; readonly condition: { readonly name: string; readonly check: (scope: { readonly initial: InitialState }) => unknown } }): Promise<void> {
  const { initial, condition } = input;
  context.pending.set(executionId, { title: condition.name, phase: 'precondition' });
  try {
    await context.input.step(condition.name, async () => {
      await assertionScope(() => condition.check({ initial: (observer) => selection.initial(initial.checkpoint, observer) }));
    });
    ensureActive(context);
    context.journal.append({ kind: 'precondition', executionId, title: condition.name, status: 'passed' });
  } catch (error) {
    if (context.active) { context.journal.append({ kind: 'precondition', executionId, title: condition.name, status: failureStatus(error), error }); }
    throw error;
  } finally { context.pending.delete(executionId); }
}
export async function action<T>(context: LifecycleContext, executionId: string, title: string, callback: (scope: { readonly request: LifecycleContext['input']['request']; readonly headers: Readonly<Record<string, string>> }) => T | Promise<T>): Promise<{ readonly result: T; readonly activityId: string }> {
  context.pending.set(executionId, { title, phase: 'action' });
  let activityId: string | undefined;
  try {
    const result = await context.input.step.stimulus(title, (scope) => {
      activityId = scope.activityId;
      context.pending.set(executionId, { title, phase: 'action', activityId });
      return callback({ request: context.input.request, headers: scope.headers });
    });
    ensureActive(context);
    if (activityId === undefined) { throw new Error('Blackbox stimulus activity identity is unavailable'); }
    context.journal.append({ kind: 'action', executionId, status: 'completed', activityId, output: result });
    return { result, activityId };
  } catch (error) {
    if (context.active) { context.journal.append({ kind: 'action', executionId, status: 'failed', ...(activityId === undefined ? {} : { activityId }), error }); }
    throw error;
  } finally { context.pending.delete(executionId); }
}
export async function effectCut(context: LifecycleContext, executionId: string, activityId: string): Promise<EffectCapture | undefined> {
  if (context.input.afterActionCapture === undefined) { return; }
  context.pending.set(executionId, { title: 'Effects capture', phase: 'effects', activityId });
  try { const captured = await context.input.afterActionCapture({ executionId, activityId }); ensureActive(context); return captured; }
  catch (error) {
    if (context.active) { context.captureFailed = true; context.journal.append({ kind: 'capture-failure', executionId, phase: 'effects', error }); }
    throw error;
  } finally { context.pending.delete(executionId); }
}
