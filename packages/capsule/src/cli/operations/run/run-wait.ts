import { setTimeout as delay } from 'node:timers/promises';

import type { TelemetryWait } from '../inspection/show-json.js';

export const WAIT_POLL_MS = 150;
export const WAIT_QUIET_MS = 750;
export const DEFAULT_WAIT_CAP_MS = 5000;

export interface WaitClock {
  now(): number;
  /** Resolves after `milliseconds`, or early once `signal` aborts. Never rejects. */
  sleep(milliseconds: number, signal: AbortSignal): Promise<void>;
}

export const systemClock = {
  now: () => performance.now(),
  sleep: (milliseconds: number, signal: AbortSignal) =>
    delay(milliseconds, undefined, { signal }).catch(() => undefined),
} satisfies WaitClock;

/**
 * Waits for an exited child's telemetry. Every `WAIT_POLL_MS` it reads the
 * collector's accepted-span total (`poll`, null when unreadable); only when
 * that total changes does it call `arrived` to re-read the spans. It stops
 * once no new span arrived for `WAIT_QUIET_MS`, at `capMs`, or when `signal`
 * aborts (Ctrl-C). `stillArriving` is true only when the cap ended the wait
 * while spans were arriving. The wait never decides the observation status.
 */
export async function waitForTelemetry(input: {
  readonly capMs: number;
  readonly clock: WaitClock;
  readonly signal: AbortSignal;
  /** The total seen when the child exited (the baseline), or null. */
  readonly baseline: number | null;
  readonly poll: () => Promise<number | null>;
  readonly arrived: () => Promise<void>;
}): Promise<TelemetryWait> {
  const { clock } = input;
  // Read afresh each time: the signal aborts while the wait sleeps.
  const interrupted = () => input.signal.aborted;
  const start = clock.now();
  const waited = () => clock.now() - start;
  let last = input.baseline;
  let lastArrival: number | null = null;
  for (;;) {
    if (input.capMs <= 0 || interrupted()) {
      return { waitedMs: waited(), stillArriving: false };
    }
    if (clock.now() - (lastArrival ?? start) >= WAIT_QUIET_MS) {
      return { waitedMs: waited(), stillArriving: false };
    }
    if (waited() >= input.capMs) {
      return { waitedMs: waited(), stillArriving: lastArrival !== null };
    }
    await clock.sleep(Math.min(WAIT_POLL_MS, input.capMs - waited()), input.signal);
    if (interrupted()) {
      return { waitedMs: waited(), stillArriving: false };
    }
    const current = await input.poll();
    if (current !== null && current !== last) {
      last = current;
      lastArrival = clock.now();
      await input.arrived();
    }
  }
}
