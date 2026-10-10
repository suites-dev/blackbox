import type { CollectorLifecycleRecord } from '@suites/blackbox-otel-collector';

import type { CapsuleSessionState } from '../model/session-state.js';

/**
 * Whether a capsule's retained observations can be treated as everything the
 * collector will ever hold. While the capsule runs nothing is final.
 */
export type ObservationCompleteness =
  | { readonly status: 'provisional' }
  | { readonly status: 'complete' }
  | { readonly status: 'incomplete'; readonly reason: string };

const provisional = { status: 'provisional' } as const;
const complete = { status: 'complete' } as const;

function incomplete(reason: string): ObservationCompleteness {
  return { status: 'incomplete', reason };
}

function stoppedCompleteness(lifecycle: CollectorLifecycleRecord | null): ObservationCompleteness {
  const runs = lifecycle === null ? [] : lifecycle.runs;
  if (runs.length === 0) {
    return incomplete('no collector record');
  }
  if (runs.some((run) => run.shutdown === 'timed-out')) {
    return incomplete('collector shutdown timed out');
  }
  if (runs.some((run) => run.receiver === 'interrupted' || run.shutdown === 'interrupted')) {
    return incomplete('collector interrupted');
  }
  for (const run of runs) {
    if (run.failure !== null) {
      return incomplete(`collector failed: ${run.failure.name}`);
    }
  }
  // Every run must have drained and stopped; a run left in any other state
  // (for example still draining) was never closed.
  return runs.every((run) => run.receiver === 'stopped' && run.shutdown === 'complete')
    ? complete
    : incomplete('collector not stopped');
}

/**
 * The single source of every observation status the CLI prints. `lifecycle`
 * is the collector lifecycle record, or null when none could be read.
 */
export function observationCompleteness(input: {
  readonly state: CapsuleSessionState;
  readonly lifecycle: CollectorLifecycleRecord | null;
}): ObservationCompleteness {
  switch (input.state) {
    case 'admitted':
    case 'manager-starting':
    case 'sandbox-starting':
    case 'running':
    case 'stopping':
      return provisional;
    case 'stopped':
      return stoppedCompleteness(input.lifecycle);
    case 'start-failed':
    case 'stop-failed':
    case 'manager-failed':
      return incomplete(`capsule ${input.state}`);
  }
}

/**
 * The status of a capsule from its state and its collector session read: a
 * stopped capsule whose session record is corrupt is incomplete, as `show`
 * states it; otherwise {@link observationCompleteness}.
 */
export function sessionCompleteness(input: {
  readonly state: CapsuleSessionState;
  readonly session:
    | { readonly kind: 'collector-session-found'; readonly lifecycle: CollectorLifecycleRecord }
    | { readonly kind: 'collector-session-corrupt'; readonly error: { readonly name: string } }
    | { readonly kind: 'collector-session-missing' }
    | null;
}): ObservationCompleteness {
  const { session } = input;
  if (
    input.state === 'stopped' &&
    session !== null &&
    session.kind === 'collector-session-corrupt'
  ) {
    return incomplete(`collector session corrupt: ${session.error.name}`);
  }
  return observationCompleteness({
    state: input.state,
    lifecycle:
      session !== null && session.kind === 'collector-session-found' ? session.lifecycle : null,
  });
}
