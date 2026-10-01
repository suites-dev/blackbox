import { LiveRunBlock, type RunBlockInput } from './run-block.js';
import { acceptedSpans, type RunTelemetry, type RunSnapshot } from './run-telemetry.js';
import { waitForTelemetry, type WaitClock } from './run-wait.js';

/** Stops the telemetry wait on Ctrl-C instead of letting the signal end the process. */
export function interruptOnSigint(): {
  readonly signal: AbortSignal;
  readonly dispose: () => void;
} {
  const controller = new AbortController();
  const abort = () => {
    controller.abort();
  };
  process.on('SIGINT', abort);
  return {
    signal: controller.signal,
    dispose: () => {
      process.off('SIGINT', abort);
    },
  };
}

/** The block drawn in place while waiting, when stderr is a terminal and not --json. */
export function liveBlock(json: boolean): LiveRunBlock | null {
  const stderr = process.stderr;
  if (json || !stderr.isTTY) {
    return null;
  }
  return new LiveRunBlock({
    write: (text) => stderr.write(text),
    viewport: () => ({ columns: stderr.columns || 80, rows: stderr.rows || 24 }),
  });
}

/**
 * Waits for the activity's telemetry and returns the final snapshot, or null
 * when the activity record cannot be read (nothing to show, so no wait).
 * `draw` is called with each snapshot as spans arrive.
 */
export async function observeRun(input: {
  readonly telemetry: Pick<RunTelemetry, 'acceptedSpans' | 'session' | 'snapshot' | 'stateChanged'>;
  readonly capMs: number;
  readonly clock: WaitClock;
  readonly signal: AbortSignal;
  readonly draw: (snapshot: RunSnapshot, wait: RunBlockInput['wait']) => void;
}): Promise<{ readonly snapshot: RunSnapshot; readonly wait: RunBlockInput['wait'] } | null> {
  const first = await input.telemetry.session();
  const initial = await input.telemetry.snapshot(first);
  if (initial === null) {
    return null;
  }
  let snapshot = initial;
  input.draw(snapshot, { waitedMs: 0, stillArriving: false });
  const start = input.clock.now();
  const wait = await waitForTelemetry({
    capMs: input.capMs,
    clock: input.clock,
    signal: input.signal,
    baseline: acceptedSpans(first),
    // Each poll reads only the lifecycle counter; the session and every
    // retained trace are read again only when that counter changed.
    poll: () => input.telemetry.acceptedSpans(),
    arrived: async () => {
      snapshot = (await input.telemetry.snapshot(await input.telemetry.session())) ?? snapshot;
      input.draw(snapshot, { waitedMs: input.clock.now() - start, stillArriving: false });
    },
  });
  // The capsule may have stopped meanwhile: its status then comes from its
  // current state and final collector record, still decided by the 2a function.
  if (await input.telemetry.stateChanged()) {
    snapshot = (await input.telemetry.snapshot(await input.telemetry.session())) ?? snapshot;
  }
  return { snapshot, wait };
}
