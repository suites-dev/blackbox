import { randomUUID } from 'node:crypto';
import { AssertionScopeError, InconclusiveAssertionError } from '../../assertions/types.js';
import { assertionScope } from '../../assertions/scope.js';
import { ensureActive, prefix, type LifecycleContext } from './context.js';
import type { LifecycleStatus } from './journal.js';
import type { ExecutionResult } from './types.js';

export function failureStatus(error: unknown): LifecycleStatus {
  if (error instanceof InconclusiveAssertionError) { return 'inconclusive'; }
  if (error instanceof AssertionScopeError && error.failures.length > 0 &&
      error.failures.every((failure) => failureStatus(failure) === 'inconclusive')) { return 'inconclusive'; }
  return 'failed';
}
export function createVerification(context: LifecycleContext, executionId: string): ExecutionResult<unknown>['verify'] {
  return async (title, callback) => {
    prefix(title, ['Then', 'And']);
    ensureActive(context);
    const claimId = randomUUID();
    context.claims.set(claimId, { executionId, title });
    try {
      const value = await context.input.step(title, async () => (await assertionScope(callback)).value);
      ensureActive(context);
      context.journal.append({ kind: 'claim', executionId, claimId, title, status: 'passed' });
      return value;
    } catch (error) {
      if (context.active) { context.journal.append({ kind: 'claim', executionId, claimId, title, status: failureStatus(error), error }); }
      throw error;
    } finally { context.claims.delete(claimId); }
  };
}
