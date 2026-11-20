import {
  assertActive, invocationContext, issue, logicalRecords, scopeContext, scopeError, trialContext,
  type AssertionScopeState, type Invocation, type Trial,
} from './context.js';
import { consumptionPromise } from './promises.js';
import { recordSnapshot } from './claims/context.js';

export function beginInvocation(scope: AssertionScopeState, name: string, poll: boolean): Invocation {
  assertActive(scope);
  const parent = invocationContext.getStore() ?? null;
  if (parent !== null && (parent.scope.owner !== scope.owner || parent.settled)) {
    throw scopeError(scope, 'ownership');
  }
  const invocation = {
    scope, parent, name, poll, status: 'pending', stepSeen: false, completionSeen: false,
    consumed: true, settled: false, failures: [], trial: null,
  } satisfies Invocation;
  const record: Invocation = invocation;
  for (let current: AssertionScopeState | null = scope; current !== null; current = current.parent) {
    current.records.add(record);
  }
  const trial = trialContext.getStore();
  if (trial !== undefined) { trial.records.add(record); }
  scope.owner.operations.add(record);
  return record;
}

function finishInvocation(invocation: Invocation): void {
  invocation.settled = true;
  if (!invocation.stepSeen || !invocation.completionSeen) {
    issue(invocation.scope, 'unsupported', scopeError(invocation.scope, 'unsupported'));
  }
  const trial = invocation.trial;
  if (trial !== null && !trial.thrown) {
    const failed = logicalRecords(trial.records).some((record) => record.status !== 'passed' || !record.consumed);
    if (failed || trial.issues.length > 0) {
      invocation.status = 'failed';
      invocation.failures.push(...trial.issues, ...[...trial.records].flatMap((record) => record.failures));
    }
  }
  if (invocation.status === 'pending') { invocation.status = 'passed'; }
  recordSnapshot(invocation.name, !invocation.stepSeen || !invocation.completionSeen ? 'unknown' : invocation.status);
}

export function invokeTracked(invocation: Invocation, invoke: () => unknown): unknown {
  let result: unknown;
  try { result = invocationContext.run(invocation, invoke); }
  catch (error) {
    invocation.status = 'failed';
    invocation.failures.push(error);
    finishInvocation(invocation);
    throw error;
  }
  if (!(result instanceof Promise)) { finishInvocation(invocation); return result; }
  invocation.consumed = false;
  const tracked = result.then(
    (value: unknown) => { finishInvocation(invocation); return value; },
    (error: unknown) => {
      invocation.status = 'failed'; invocation.failures.push(error); finishInvocation(invocation); throw error;
    },
  );
  return consumptionPromise(tracked, invocation);
}

export function retryCallback(actual: (...args: unknown[]) => unknown, invocation: Invocation) {
  return async (...args: unknown[]) => {
    const trial = { records: new Set<Invocation>(), issues: [], thrown: false } satisfies Trial;
    const state: Trial = trial;
    invocation.trial = state;
    try { return await trialContext.run(trial, () => actual(...args)); }
    catch (error) { state.thrown = true; throw error; }
  };
}

export function activeInvocationScope(captured: AssertionScopeState | null): AssertionScopeState | null {
  const scope = scopeContext.getStore() ?? null;
  if (captured !== null && (scope !== captured || !captured.active || !captured.owner.active)) {
    throw scopeError(captured, 'ownership');
  }
  if (scope !== null) { assertActive(scope); }
  return scope;
}
