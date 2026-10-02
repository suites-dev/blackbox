import type { TelemetryPropagationRecord } from '@suites/blackbox-telemetry';

import { createRedactionContext, redactText } from '../reporting/redaction.js';
import type { CapsuleActivityReport } from '../model/activity.js';

/** What happened to the activity's trace context, as show reports it. */
export type ActivityContext =
  | { readonly kind: 'sent'; readonly carrier: string }
  | { readonly kind: 'not-carried'; readonly resource: string }
  | { readonly kind: 'untraced' }
  | { readonly kind: 'not-sent' }
  | { readonly kind: 'injection-failed'; readonly carrier: string; readonly message: string };

type PropagationOutcome = TelemetryPropagationRecord['outcome'];

function propagationOutcome(activity: CapsuleActivityReport): PropagationOutcome | null {
  if (activity.kind !== 'completed') {
    return null;
  }
  const outcome = activity.outcome;
  return 'propagation' in outcome ? outcome.propagation.outcome : null;
}

/**
 * The activity's trace-context outcome, or null when it is unknown (the
 * activity has no completed outcome) or no process ever existed (the driver
 * failed first). An injection-failure message is redacted like the report's.
 */
export function activityContext(activity: CapsuleActivityReport): ActivityContext | null {
  if (
    activity.kind === 'completed' &&
    (activity.outcome.kind === 'driver-prepare-failed' ||
      activity.outcome.kind === 'driver-propagation-refused')
  ) {
    return null;
  }
  const outcome = propagationOutcome(activity);
  if (outcome === null) {
    return null;
  }
  switch (outcome.kind) {
    case 'context-injected':
      return { kind: 'sent', carrier: outcome.carrier };
    case 'context-not-supported':
      return { kind: 'not-carried', resource: outcome.resource };
    case 'context-not-injected':
      return outcome.reason === 'raw-command' ? { kind: 'untraced' } : { kind: 'not-sent' };
    case 'context-injection-failed':
      return {
        kind: 'injection-failed',
        carrier: outcome.carrier,
        message: redactText(outcome.message, 'context.message', createRedactionContext()),
      };
  }
}
