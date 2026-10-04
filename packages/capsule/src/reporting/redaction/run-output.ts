import type {
  CapsuleExecutionOutcome,
  CapsuleRawCommandOutcome,
} from '../../model/execution/outcome.js';
import type { CapsuleProcessOutcome } from '../../model/execution/process-outcome.js';
import { createRedactionContext, redactText } from './text.js';

/** Whether `capsule run --json` prints the child's output redacted (the default) or as captured. */
export type RunOutputRedaction = 'redacted' | 'raw';

function redactStreams(outcome: CapsuleProcessOutcome): CapsuleProcessOutcome {
  if (outcome.kind === 'executable-not-found' || outcome.kind === 'not-executable') {
    return outcome;
  }
  const context = createRedactionContext();
  return {
    ...outcome,
    stdout: redactText(outcome.stdout, 'outcome.stdout', context),
    stderr: redactText(outcome.stderr, 'outcome.stderr', context),
  };
}

/**
 * The child's stdout and stderr in a run outcome, passed through the report's
 * text redaction (credentials, sensitive JSON fields and query values), unless
 * `raw`. Retention metadata still describes what was captured.
 */
export function redactOutcomeOutput(
  outcome: CapsuleExecutionOutcome,
  output: RunOutputRedaction,
): CapsuleExecutionOutcome {
  if (output === 'raw') {
    return outcome;
  }
  switch (outcome.kind) {
    case 'driver-completed':
      return { ...outcome, process: redactStreams(outcome.process) };
    case 'driver-prepare-failed':
    case 'driver-propagation-refused':
      return outcome;
    case 'executable-not-found':
    case 'not-executable':
    case 'exited':
    case 'signaled':
      return 'propagation' in outcome
        ? ({
            ...redactStreams(outcome),
            propagation: outcome.propagation,
          } satisfies CapsuleRawCommandOutcome)
        : redactStreams(outcome);
  }
}
