import { declarationError, ensureSynchronous } from '../declarations/validation.js';

export function assertActive(active: () => boolean): void {
  if (!active()) {
    throw declarationError('Gherkin declaration scope cannot be used after its callback returns');
  }
}
export function synchronousScope<Scope>(
  scope: Scope,
  body: (scope: Scope) => unknown,
  label: string,
): void {
  ensureSynchronous(body(scope), label);
}
