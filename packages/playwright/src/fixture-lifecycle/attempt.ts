import { dirname, isAbsolute, resolve } from 'node:path';

import type { TestInfo } from '@playwright/test';
import { recoverSandbox, type SandboxStopReason } from '@suites/blackbox-sandbox';

import { bindEffectAssertionReporter } from '../effects/runtime.js';
import type { ReceiptRecorder } from '../history/receipts/recorder.js';
import { AttemptReport } from '../reporting/attempt.js';
import { reported } from '../reporting/events.js';
import { reportObservations } from '../reporting/observations.js';
import { attachReceipt, startReceipt } from '../reporting/capture/receipt.js';
import type { BlackboxAttemptRuntime, RunningBlackboxAttempt } from '../runtime/acquisition.js';
import { retainAttempt, retainedAttemptDirectory } from '../retention/retention.js';
import type { BlackboxAttemptOptions } from '../config/options.js';
import {
  startPreludeCapture,
  newAttemptProduct,
  settleAttempt,
  type AttemptProduct,
  type FinalCaptureInput,
} from './final-capture.js';
import {
  acquireWithinTestTimeout,
  stopWithinCleanupTimeout,
  type BlackboxFixturePolicy,
} from './timeouts.js';

interface AttemptFixtureInput extends BlackboxAttemptOptions {
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
    snapshotEnabled: input.blackboxFinalSnapshot,
    testInfo: input.testInfo,
    configFile: configFilePath(input.testInfo),
    entryId: input.catalogEntry.kind === 'unselected' ? '' : input.catalogEntry.id,
    variables: input.blackboxEnvironment,
  };
}

async function acquire(
  input: AttemptFixtureInput,
  report: AttemptReport,
  recorder: ReceiptRecorder | null,
): Promise<RunningBlackboxAttempt> {
  try {
    return await acquireWithinTestTimeout({
      runtime: input.runtime,
      testInfo: input.testInfo,
      cleanupTimeoutMs: input.policy.sandboxCleanupTimeoutMs,
      recoverSandbox,
      request: {
        selection: input.catalogEntry,
        configFile: configFilePath(input.testInfo),
        environment: input.blackboxEnvironment,
        clientTargets: Object.values(input.blackboxClients).map(({ target }) => target),
        artifactDirectory: input.testInfo.outputPath('blackbox'),
        progress: report,
      },
    });
  } catch (error) {
    if (recorder !== null) {
      recorder.acquisitionFailed(report.lastPhase(), report.describe(error));
    }
    throw error;
  }
}

async function useAttempt(
  input: AttemptFixtureInput,
  report: AttemptReport,
  context: {
    readonly capture: FinalCaptureInput;
    readonly attempt: RunningBlackboxAttempt;
    readonly product: AttemptProduct;
  },
): Promise<void> {
  const { capture, attempt, product } = context;
  report.acquired(attempt.sandbox, attempt.telemetry);
  bindEffectAssertionReporter(attempt.effects, report);
  report.emit(
    'sandbox',
    'completed',
    `${attempt.sandbox.sandboxId}; ${attempt.sandbox.entrypoint.url}`,
  );
  report.emit('execution', 'started', 'test fixtures, hooks and body');
  let executionError: unknown = null;
  try {
    await report.flush();
    report.lifecycle('ready', attempt.sandbox.catalogEntry);
    await input.use(attempt);
  } catch (error) {
    product.executionFailed = true;
    executionError = error;
  }
  try {
    const reason = product.executionFailed ? 'failed' : stopReason(input.testInfo.status);
    report.emit('execution', 'info', input.testInfo.status ?? 'unknown');
    const actualCapture = { ...capture, enabled: capture.enabled || report.hasStimulus() };
    await settleAttempt({
      capture: actualCapture,
      report,
      attempt,
      stopReason: reason,
      prelude: startPreludeCapture(actualCapture),
      product,
      cleanup: () => finishAttempt(attempt, report, reason, input.policy),
    });
  } catch (error) {
    if (executionError !== null) { throw new AggregateError([executionError, error], 'Blackbox execution and cleanup failed'); }
    throw error;
  }
  if (executionError !== null) { throw new Error('Blackbox execution failed', { cause: executionError }); }
}

export async function runAttemptFixture(input: AttemptFixtureInput): Promise<void> {
  const report = new AttemptReport(input.testInfo);
  report.protect(input.blackboxEnvironment);
  const capture = finalCaptureInput(input);
  const entryId = input.catalogEntry.kind === 'unselected' ? '' : input.catalogEntry.id;
  const recorder = input.catalogEntry.kind !== 'unselected' ? startReceipt(input.testInfo, entryId) : null;
  const product = newAttemptProduct();
  const errors: unknown[] = [];
  try {
    const attempt = await acquire(input, report, recorder);
    if (recorder !== null) {
      recorder.started(attempt.sandbox.sandboxId);
    }
    await useAttempt(input, report, { capture, attempt, product });
  } catch (error) {
    report.emit('attempt', 'failed', 'setup or teardown failed; see test error');
    errors.push(error);
  }
  if (recorder !== null && (capture.enabled || report.hasStimulus())) {
    try {
      await attachReceipt({
        testInfo: input.testInfo,
        recorder,
        catalogEntryId: entryId,
        envelope: product.envelope,
        attemptFailed: errors.length > 0,
      });
    } catch (error) {
      report.emit('receipt', 'failed', 'could not attach the attempt receipt');
      errors.push(error);
    }
  }
  try {
    await closeReport(report, input);
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) {
    const error = errors[0];
    if (error instanceof Error) { throw error; }
    throw new Error('Blackbox attempt failed', { cause: error });
  }
  if (errors.length > 1) { throw new AggregateError(errors, 'Blackbox attempt failed'); }
}
