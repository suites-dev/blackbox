import type { CapsuleProcessOutcome } from '../model/outcome.js';

/** The process outcomes that never started a process, so carry no output. */
export type CapsuleUnstartedProcessOutcome = Extract<
  CapsuleProcessOutcome,
  { readonly kind: 'executable-not-found' | 'not-executable' }
>;

export function isUnstartedProcess(
  outcome: CapsuleProcessOutcome,
): outcome is CapsuleUnstartedProcessOutcome {
  return outcome.kind === 'executable-not-found' || outcome.kind === 'not-executable';
}
