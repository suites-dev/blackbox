import type { StartedComposeSandbox } from '../../model/compose.js';
import { asError, type CleanupOutcome } from '../errors.js';
import { withTimeout } from '../helpers.js';

type CleanupStep =
  | { readonly kind: 'complete' }
  | { readonly kind: 'failed'; readonly error: unknown };

async function attempt(operation: Promise<void>): Promise<CleanupStep> {
  try {
    await operation;
    return { kind: 'complete' };
  } catch (error) {
    return { kind: 'failed', error };
  }
}

/** How long a failed cleanup may spend asking Docker which containers remain. */
const REMAINING_INSPECTION_TIMEOUT_MS = 5_000;

/** Names the participants Docker still has, so a failed cleanup says what blocked it. */
async function namedCleanupFailure(
  compose: StartedComposeSandbox,
  error: unknown,
): Promise<CleanupStep> {
  const cause = asError(error);
  try {
    const remaining = await withTimeout({
      operation: compose.inspectRemainingContainers(),
      timeoutMs: REMAINING_INSPECTION_TIMEOUT_MS,
      label: 'Remaining container inspection',
    });
    if (remaining.length === 0) {
      return { kind: 'failed', error: cause };
    }
    const names = remaining.map(({ service, state }) => `${service} (${state})`).join(', ');
    return { kind: 'failed', error: new Error(`${cause.message}; still present: ${names}`, { cause }) };
  } catch {
    return { kind: 'failed', error: cause };
  }
}

export async function cleanupCompose(input: {
  readonly compose: StartedComposeSandbox;
  readonly timeoutMs: number;
}): Promise<void> {
  const preparation = await attempt(
    withTimeout({
      operation: input.compose.prepareStop({ timeoutMs: input.timeoutMs }),
      timeoutMs: input.timeoutMs,
      label: 'Sandbox telemetry drain',
    }),
  );
  const cleanup = await attempt(
    withTimeout({
      operation: input.compose.stop({ timeoutMs: input.timeoutMs }),
      timeoutMs: input.timeoutMs,
      label: 'Sandbox cleanup',
    }),
  ).then((step) => (step.kind === 'failed' ? namedCleanupFailure(input.compose, step.error) : step));
  if (preparation.kind === 'complete' && cleanup.kind === 'complete') {
    return;
  }
  if (preparation.kind === 'failed' && cleanup.kind === 'failed') {
    throw new AggregateError(
      [preparation.error, cleanup.error],
      'Sandbox preparation and Compose cleanup both failed',
    );
  }
  if (preparation.kind === 'failed') {
    throw preparation.error;
  }
  if (cleanup.kind === 'failed') {
    throw cleanup.error;
  }
  throw new Error('Unreachable cleanup outcome');
}

/** Runs cleanupCompose and reports its outcome instead of throwing. */
export async function attemptComposeCleanup(input: {
  readonly compose: StartedComposeSandbox;
  readonly timeoutMs: number;
}): Promise<Exclude<CleanupOutcome, { readonly kind: 'not-attempted' }>> {
  try {
    await cleanupCompose(input);
    return { kind: 'complete' };
  } catch (cause) {
    return { kind: 'failed', error: asError(cause) };
  }
}
