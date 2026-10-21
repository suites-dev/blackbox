import { dirname, isAbsolute, resolve } from 'node:path';

import type { TestInfo } from '@playwright/test';
import { recoverSandbox, type SandboxStopReason } from '@suites/blackbox-sandbox';

import { completedAttemptStimuli, recordedAttemptStimuli } from '../effects/attempt-effects.js';
import { bindEffectAssertionReporter, closeBlackboxEffects } from '../effects/runtime.js';
import { AttemptReport } from '../reporting/attempt.js';
import { reported } from '../reporting/events.js';
import { reportObservations } from '../reporting/observations.js';
import type { BlackboxAttemptRuntime, RunningBlackboxAttempt } from '../runtime/acquisition.js';
import { retainAttempt, retainedAttemptDirectory } from '../retention/retention.js';
import type { BlackboxTestOptions } from '../types.js';
import {
  attachFinalCapture,
  captureBeforeAttempt,
  type FinalCaptureInput,
} from './final-capture.js';
import {
  acquireWithinTestTimeout,
  stopWithinCleanupTimeout,
  type BlackboxFixturePolicy,
} from './timeouts.js';

interface AttemptFixtureInput extends BlackboxTestOptions {
  readonly runtime: BlackboxAttemptRuntime;
  readonly policy: BlackboxFixturePolicy;
  readonly testInfo: TestInfo;
  readonly use: (attempt: RunningBlackboxAttempt) => Promise<void>;
}

function configFilePath(testInfo: TestInfo): string {
  const declared: unknown = testInfo.config.metadata.blackboxConfigFile;
  if (typeof declared !== 'string' || declared.trim().length === 0) {
    throw new Error(
      'Set blackboxConfigFile using defineConfig from @suites/blackbox-playwright/config',
    );
  }
  if (isAbsolute(declared)) {
    return declared;
  }
  const playwrightConfig = testInfo.config.configFile;
  const root =
    playwrightConfig === undefined || playwrightConfig.length === 0
      ? process.cwd()
      : dirname(playwrightConfig);
  return resolve(root, declared);
}

function stopReason(status: TestInfo['status']): SandboxStopReason {
  switch (status) {
    case 'passed':
      return 'completed';
    case 'skipped':
      return 'cancelled';
    case 'interrupted':
      return 'interrupted';
    case 'failed':
    case 'timedOut':
    case undefined:
      return 'failed';
  }
}

async function finishAttempt(
  attempt: RunningBlackboxAttempt,
  report: AttemptReport,
  reason: SandboxStopReason,
  policy: BlackboxFixturePolicy,
): Promise<void> {
  try {
    await reported(report, 'teardown', `reason=${reason}; cleanup owned resources`, () =>
      stopWithinCleanupTimeout({
        attempt,
        reason,
        cleanupTimeoutMs: policy.sandboxCleanupTimeoutMs,
      }),
    );
  } catch (error) {
    report.lifecycle('cleanup failed', attempt.sandbox.catalogEntry);
    throw error;
  }
  report.lifecycle('cleaned up', attempt.sandbox.catalogEntry);
  await reportObservations(report, attempt);
}

/** Attach the final document, then copy the attempt out of Playwright's output when asked. */
async function closeReport(report: AttemptReport, input: AttemptFixtureInput): Promise<void> {
  const document = await report.finish();
  const sandboxId = report.sandboxId();
  if (input.blackboxRetainAttempts && sandboxId !== null) {
    await retainAttempt({
      directory: retainedAttemptDirectory(configFilePath(input.testInfo), sandboxId),
      recordDirectory: input.testInfo.outputPath('blackbox'),
      document,
    });
  }
}

function finalCaptureInput(input: AttemptFixtureInput): FinalCaptureInput {
  return {
    enabled: input.blackboxFinalSnapshot && input.catalogEntry.kind !== 'unselected',
    testInfo: input.testInfo,
    configFile: configFilePath(input.testInfo),
    entryId: input.catalogEntry.kind === 'unselected' ? '' : input.catalogEntry.id,
    variables: input.blackboxEnvironment,
  };
}

export async function runAttemptFixture(input: AttemptFixtureInput): Promise<void> {
  const report = new AttemptReport(input.testInfo);
  report.protect(input.blackboxEnvironment);
  const capture = finalCaptureInput(input);
  try {
    const prelude = await captureBeforeAttempt(capture);
    const attempt = await acquireWithinTestTimeout({
      runtime: input.runtime,
      testInfo: input.testInfo,
      cleanupTimeoutMs: input.policy.sandboxCleanupTimeoutMs,
      recoverSandbox,
      request: {
        selection: input.catalogEntry,
        configFile: configFilePath(input.testInfo),
        environment: input.blackboxEnvironment,
        clientTargets: Object.values(input.blackboxClients ?? {}).map(({ target }) => target),
        artifactDirectory: input.testInfo.outputPath('blackbox'),
        progress: report,
      },
    });
    report.acquired(attempt.sandbox, attempt.telemetry);
    bindEffectAssertionReporter(attempt.effects, report);
    report.emit(
      'sandbox',
      'completed',
      `${attempt.sandbox.sandboxId}; ${attempt.sandbox.entrypoint.url}`,
    );
    report.emit('execution', 'started', 'test fixtures, hooks and body');
    try {
      await report.flush();
      report.lifecycle('ready', attempt.sandbox.catalogEntry);
      await input.use(attempt);
    } finally {
      const stimuli = completedAttemptStimuli(attempt.effects);
      const recorded = recordedAttemptStimuli(attempt.effects);
      closeBlackboxEffects(attempt.effects);
      const reason = stopReason(input.testInfo.status);
      report.emit('execution', 'info', input.testInfo.status ?? 'unknown');
      try {
        await finishAttempt(attempt, report, reason, input.policy);
      } finally {
        // After cleanup the collector has stopped, so this read is final. It also runs when cleanup failed,
        // where the collector's own state is what the snapshot reports.
        await attachFinalCapture(capture, report, {
          attempt,
          stimuli,
          recorded,
          stopReason: reason,
          prelude,
        });
      }
    }
  } catch (error) {
    report.emit('attempt', 'failed', 'setup or teardown failed; see test error');
    throw error;
  } finally {
    await closeReport(report, input);
  }
}
