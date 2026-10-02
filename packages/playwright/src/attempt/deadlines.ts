import type { TestInfo } from '@playwright/test';
import type { SandboxStopReason } from '@suites/blackbox-sandbox';

import type { BlackboxAttemptRuntime, RunningBlackboxAttempt } from '../runtime/acquisition.js';

const acquisitionTimedOut = Symbol('acquisitionTimedOut');

export const defaultSandboxCleanupTimeoutMs = 30_000;

const cleanupCompleted = Symbol('cleanupCompleted');
const cleanupTimedOut = Symbol('cleanupTimedOut');

export interface BlackboxFixturePolicy {
  /** Maximum time to wait for any sandbox cleanup operation. */
  readonly sandboxCleanupTimeoutMs: number;
}

async function cleanupSettledWithin(cleanup: Promise<void>, timeoutMs: number): Promise<boolean> {
  // If the bounded wait expires, retain a rejection handler without awaiting
  // this continuation in fixture teardown.
  void cleanup.catch(() => undefined);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof cleanupTimedOut>((resolveTimeout) => {
    timer = setTimeout(() => {
      resolveTimeout(cleanupTimedOut);
    }, timeoutMs);
  });
  const outcome = await Promise.race([cleanup.then(() => cleanupCompleted), deadline]).finally(
    () => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    },
  );
  return outcome === cleanupCompleted;
}

async function awaitLateAcquisitionCleanup(input: {
  readonly acquisition: Promise<RunningBlackboxAttempt>;
  readonly timeoutError: Error;
  readonly cleanupTimeoutMs: number;
}): Promise<never> {
  const cleanup = input.acquisition.then(
    async (attempt) => {
      try {
        await attempt.stop('failed');
      } catch (cleanupError) {
        throw new AggregateError(
          [input.timeoutError, cleanupError],
          'Blackbox sandbox acquisition timed out and cleanup failed',
        );
      }
    },
    (cause: unknown) => {
      throw new Error(input.timeoutError.message, { cause });
    },
  );
  if (!(await cleanupSettledWithin(cleanup, input.cleanupTimeoutMs))) {
    throw new AggregateError(
      [input.timeoutError],
      `Blackbox sandbox acquisition cleanup did not settle within ${input.cleanupTimeoutMs}ms`,
    );
  }
  throw input.timeoutError;
}

export async function stopWithinCleanupTimeout(input: {
  readonly attempt: RunningBlackboxAttempt;
  readonly reason: SandboxStopReason;
  readonly cleanupTimeoutMs: number;
}): Promise<void> {
  if (!(await cleanupSettledWithin(input.attempt.stop(input.reason), input.cleanupTimeoutMs))) {
    throw new Error(
      `Blackbox sandbox cleanup did not settle within ${input.cleanupTimeoutMs}ms after ${input.reason}`,
    );
  }
}

export async function acquireWithinTestTimeout(input: {
  readonly runtime: BlackboxAttemptRuntime;
  readonly request: Parameters<BlackboxAttemptRuntime['start']>[0];
  readonly testInfo: TestInfo;
  readonly cleanupTimeoutMs: number;
}): Promise<RunningBlackboxAttempt> {
  const acquisition = input.runtime.start(input.request);
  if (input.testInfo.timeout === 0) {
    return acquisition;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof acquisitionTimedOut>((resolveTimeout) => {
    timer = setTimeout(() => {
      resolveTimeout(acquisitionTimedOut);
    }, input.testInfo.timeout);
  });
  const outcome = await Promise.race([acquisition, deadline]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
  if (outcome !== acquisitionTimedOut) {
    return outcome;
  }

  const timeoutError = new Error(
    `Blackbox sandbox acquisition exceeded the Playwright test timeout of ${input.testInfo.timeout}ms`,
  );
  return awaitLateAcquisitionCleanup({
    acquisition,
    timeoutError,
    cleanupTimeoutMs: input.cleanupTimeoutMs,
  });
}
