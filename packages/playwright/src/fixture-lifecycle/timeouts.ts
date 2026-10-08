import type { TestInfo } from '@playwright/test';
import {
  findInterruptedSandboxes,
  type recoverSandbox,
  type SandboxStopReason,
} from '@suites/blackbox-sandbox';

import type { BlackboxAttemptRuntime, RunningBlackboxAttempt } from '../runtime/acquisition.js';

const acquisitionTimedOut = Symbol('acquisitionTimedOut');
const cleanupCompleted = Symbol('cleanupCompleted');
const cleanupTimedOut = Symbol('cleanupTimedOut');

export interface BlackboxFixturePolicy {
  /** Maximum time to wait for any sandbox cleanup operation. */
  readonly sandboxCleanupTimeoutMs: number;
}

async function cleanupSettledWithin(cleanup: Promise<void>, timeoutMs: number): Promise<boolean> {
  void cleanup.catch(() => undefined);

  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<typeof cleanupTimedOut>((resolveTimeout) => {
    timer = setTimeout(() => {
      resolveTimeout(cleanupTimedOut);
    }, timeoutMs);
  });
  const outcome = await Promise.race([cleanup.then(() => cleanupCompleted), deadline]).finally(
    () => {
      clearTimeout(timer);
    },
  );
  return outcome === cleanupCompleted;
}

/**
 * Ends every sandbox record an abandoned acquisition left active. Without this,
 * a worker that exits while Compose is still starting leaves the record
 * `starting` with no stop reason or cleanup. Returns the recovery failures.
 */
async function recoverAbandonedSandboxes(input: {
  readonly recordDirectory: string;
  readonly timeoutMs: number;
  readonly recoverSandbox: typeof recoverSandbox;
}): Promise<readonly unknown[]> {
  let interrupted: Awaited<ReturnType<typeof findInterruptedSandboxes>>;
  try {
    interrupted = await findInterruptedSandboxes({ recordDirectory: input.recordDirectory });
  } catch (error) {
    return [error];
  }
  const recoveries = await Promise.allSettled(
    interrupted.map(({ record }) =>
      input.recoverSandbox({
        recordDirectory: input.recordDirectory,
        sandboxId: record.sandboxId,
        timeoutMs: input.timeoutMs,
      }),
    ),
  );
  return recoveries.flatMap((recovery, index): unknown[] => {
    if (recovery.status === 'rejected') {
      const reason: unknown = recovery.reason;
      return [reason];
    }
    return recovery.value.kind === 'sandbox-recovery-failed'
      ? [
          new Error(
            `Sandbox ${interrupted[index].record.sandboxId} recovery cleanup failed: ` +
              recovery.value.error.message,
          ),
        ]
      : [];
  });
}

async function awaitLateAcquisitionCleanup(input: {
  readonly acquisition: Promise<RunningBlackboxAttempt>;
  readonly timeoutError: Error;
  readonly cleanupTimeoutMs: number;
  readonly recordDirectory: string;
  readonly recoverSandbox: typeof recoverSandbox;
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
    const recoveryErrors = await recoverAbandonedSandboxes({
      recordDirectory: input.recordDirectory,
      timeoutMs: input.cleanupTimeoutMs,
      recoverSandbox: input.recoverSandbox,
    });
    throw new AggregateError(
      [input.timeoutError, ...recoveryErrors],
      `Blackbox sandbox acquisition cleanup did not settle within ${input.cleanupTimeoutMs}ms` +
        (recoveryErrors.length === 0
          ? '; the abandoned sandbox was recovered'
          : '; recovering the abandoned sandbox also failed'),
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
  readonly testInfo: Pick<TestInfo, 'timeout'>;
  readonly cleanupTimeoutMs: number;
  readonly recoverSandbox: typeof recoverSandbox;
}): Promise<RunningBlackboxAttempt> {
  const acquisition = input.runtime.start(input.request);
  if (input.testInfo.timeout === 0) {
    return acquisition;
  }

  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<typeof acquisitionTimedOut>((resolveTimeout) => {
    timer = setTimeout(() => {
      resolveTimeout(acquisitionTimedOut);
    }, input.testInfo.timeout);
  });
  const outcome = await Promise.race([acquisition, deadline]).finally(() => {
    clearTimeout(timer);
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
    // Acquisition keeps its sandbox records in the attempt's artifact directory.
    recordDirectory: input.request.artifactDirectory,
    recoverSandbox: input.recoverSandbox,
  });
}
