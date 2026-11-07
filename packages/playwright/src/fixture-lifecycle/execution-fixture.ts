import type { PlaywrightTestArgs } from '@playwright/test';
import type { RunningBlackboxAttempt } from '../runtime/acquisition.js';
import type { BlackboxStep } from '../steps/types.js';
import type { StateRegistry } from '../state/types.js';
import { createStimulusLifecycle } from '../stimulus/lifecycle/runtime.js';
import { durableExecution, executionCaptureTimeoutMs } from '../stimulus/lifecycle/durable.js';

// One capture drain, a terminal write deadline and drain, plus a finite fixture margin.
export const executionFixtureTimeoutMs = 4 * executionCaptureTimeoutMs;

async function finishExecution(lifecycle: ReturnType<typeof createStimulusLifecycle>,
  durable: ReturnType<typeof durableExecution>, unsubscribe: () => void): Promise<void> {
  let closeError: unknown = null;
  try { lifecycle.close(); } catch (error) { closeError = error; }
  unsubscribe();
  try { await durable.finish(lifecycle.journal); } catch (error) {
    if (closeError !== null) { throw new AggregateError([closeError, error], 'Blackbox execution teardown failed'); }
    throw error;
  }
  if (closeError !== null) { throw new Error('Blackbox execution teardown failed', { cause: closeError }); }
}

export async function executionFixture(
  { _blackboxState, _blackboxAttempt, request, step }: {
    readonly _blackboxState: StateRegistry;
    readonly _blackboxAttempt: { readonly kind: 'unselected' } | { readonly kind: 'selected'; readonly attempt: RunningBlackboxAttempt };
    readonly request: PlaywrightTestArgs['request']; readonly step: BlackboxStep;
  },
  use: (value: ReturnType<typeof createStimulusLifecycle>) => Promise<void>,
): Promise<void> {
  if (_blackboxAttempt.kind !== 'selected') { throw new Error('Blackbox stimulus requires a selected system'); }
  const durable = durableExecution({ effects: _blackboxAttempt.attempt.effects, request });
  const lifecycle = createStimulusLifecycle({ registry: _blackboxState, request: durable.request, step,
    afterActionCapture: (cut) => durable.capture(cut) });
  const unsubscribe = lifecycle.journal.subscribe((event) => { durable.observe(event); });
  try { await use(lifecycle); } finally { await finishExecution(lifecycle, durable, unsubscribe); }
}
