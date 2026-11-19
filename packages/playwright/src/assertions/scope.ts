import { test as nativeTest, type TestInfo } from '@playwright/test';
import {
  accounting, assertActive, invocationContext, issue, owners, samplingContext, scopeContext,
  scopeError, trialContext, type AssertionOwner, type AssertionScopeState, type Consumption,
} from './context.js';
import { installAssertionBridge, installedPlaywrightVersion } from './bridge.js';
import { consumptionPromise } from './promises.js';
import { AssertionScopeError, InconclusiveAssertionError, type AssertionScopeErrorCode, type AssertionScopeResult } from './types.js';

function ownershipError() {
  return new AssertionScopeError('ownership', { total: 0, passed: 0, failed: 0, pending: 0, unconsumed: 0 });
}

function observeStep(owner: AssertionOwner, data: unknown) {
  if (typeof data !== 'object' || data === null || !('category' in data) || data.category !== 'expect') {
    return null;
  }
  const scope = scopeContext.getStore();
  if (scope === undefined) { return null; }
  assertActive(scope);
  if (scope.owner !== owner) { throw scopeError(scope, 'ownership'); }
  const invocation = invocationContext.getStore();
  if (invocation === undefined || invocation.scope.owner !== owner || invocation.stepSeen) {
    // Native poll retries create their own internal matcher steps after the sampled callback.
    if (invocation !== undefined && invocation.poll && samplingContext.getStore() !== invocation) { return null; }
    const error = scopeError(scope, 'unsupported');
    issue(scope, 'unsupported', error);
    const trial = trialContext.getStore();
    if (trial !== undefined) { trial.issues.push(error); }
    return null;
  }
  invocation.stepSeen = true;
  return (result: unknown) => {
    invocation.completionSeen = true;
    if (typeof result !== 'object' || result === null) {
      issue(scope, 'unsupported', scopeError(scope, 'unsupported'));
      return;
    }
    const error: unknown = Reflect.get(result, 'error');
    const softError: unknown = Reflect.get(result, 'softError');
    if (typeof Reflect.get(result, 'pass') !== 'boolean' && !error && !softError) {
      issue(scope, 'unsupported', scopeError(scope, 'unsupported'));
      return;
    }
    if (error || softError) {
      invocation.status = 'failed';
      invocation.failures.push(error ?? softError);
    }
  };
}

export function registerAssertionOwner(info: TestInfo): () => void {
  const owner = { info, active: true, scopes: new Set<AssertionScopeState>(),
    operations: new Set<Consumption>(), restore: null } satisfies AssertionOwner;
  const state: AssertionOwner = owner;
  owners.set(info, state);
  return () => {
    state.active = false;
    owners.delete(info);
    if (state.restore !== null) { state.restore(); }
    const operations = [...state.operations];
    if (state.scopes.size > 0 || operations.some((operation) => !operation.settled)) {
      throw new AssertionScopeError('pending', { total: 0, passed: 0, failed: 0, pending: 1, unconsumed: 0 });
    }
    if (operations.some((operation) => !operation.consumed)) {
      throw new AssertionScopeError('unconsumed', { total: 0, passed: 0, failed: 0, pending: 0, unconsumed: 1 });
    }
  };
}

function currentOwner(): AssertionOwner {
  let info: TestInfo;
  try { info = nativeTest.info(); } catch { throw ownershipError(); }
  const owner = owners.get(info);
  if (owner === undefined || !owner.active) { throw ownershipError(); }
  return owner;
}

function structuralFailure(scope: AssertionScopeState): AssertionScopeErrorCode | null {
  if (scope.issues.some(({ code }) => code === 'unsupported')) { return 'unsupported'; }
  if ([...scope.records].some((record) => !record.settled) || [...scope.children].some((child) => child.active)) {
    return 'pending';
  }
  if ([...scope.records].some((record) => !record.consumed)) { return 'unconsumed'; }
  return null;
}

function validateScope(scope: AssertionScopeState): void {
  const structural = structuralFailure(scope);
  if (structural !== null) { throw scopeError(scope, structural); }
  const counts = accounting(scope);
  if (counts.failed > 0 || scope.issues.length > 0) { throw scopeError(scope, 'failed'); }
  if (counts.total === 0) { throw scopeError(scope, 'empty'); }
}

function caughtScopeError(scope: AssertionScopeState, caught: unknown): unknown {
  const structural = structuralFailure(scope);
  if (structural !== null) { return scopeError(scope, structural); }
  if (!(caught instanceof InconclusiveAssertionError)) { return caught; }
  const counts = accounting(scope);
  if (counts.total === 0) { return scopeError(scope, 'empty'); }
  if (counts.failed > 1 || scope.issues.length > 0) { return scopeError(scope, 'failed'); }
  return caught;
}

async function executeScope<Value>(scope: AssertionScopeState, callback: () => Value | Promise<Value>) {
  try {
    const value = await scopeContext.run(scope, callback);
    validateScope(scope);
    return Object.freeze({ value, accounting: accounting(scope) });
  } catch (caught) {
    const error = caughtScopeError(scope, caught);
    if (scope.parent !== null) {
      const trial = trialContext.getStore();
      if (trial === undefined) { issue(scope.parent, 'failed', error); }
      else { trial.issues.push(error); }
    }
    throw error;
  } finally {
    scope.active = false;
    scope.owner.scopes.delete(scope);
  }
}

/** Foundational assertion accounting; this is not the execution-bound verification API. */
export function assertionScope<Value>(callback: () => Value | Promise<Value>): Promise<AssertionScopeResult<Value>> {
  const owner = currentOwner();
  const parent = scopeContext.getStore() ?? null;
  if (parent !== null) {
    assertActive(parent);
    if (parent.owner !== owner) { throw scopeError(parent, 'ownership'); }
  }
  owner.restore ??= installAssertionBridge(owner.info, installedPlaywrightVersion(), (data) => observeStep(owner, data));
  const scope = { owner, parent, active: true, records: new Set(), children: new Set(), issues: [] } satisfies AssertionScopeState;
  owner.scopes.add(scope);
  if (parent !== null) { parent.children.add(scope); }
  const consumption = { consumed: false, settled: false } satisfies Consumption;
  const operation: Consumption = consumption;
  owner.operations.add(operation);
  const promise = executeScope(scope, callback).finally(() => { operation.settled = true; });
  return consumptionPromise(promise, consumption);
}
