import { dirname, isAbsolute, resolve } from 'node:path';

import type { TestInfo } from '@playwright/test';
import type { SandboxStopReason } from '@suites/blackbox-sandbox';

import { bindEffectAssertionReporter, closeBlackboxEffects } from '../effects/runtime.js';
import { AttemptReport } from '../reporting/attempt.js';
import { reported } from '../reporting/events.js';
import { reportObservations } from '../reporting/observations.js';
import type { BlackboxAttemptRuntime, RunningBlackboxAttempt } from '../runtime/acquisition.js';
import type { BlackboxTestOptions } from '../types.js';
import {
  acquireWithinTestTimeout,
  stopWithinCleanupTimeout,
  type BlackboxFixturePolicy,
} from './timeouts.js';

interface AttemptFixtureInput extends BlackboxTestOptions {
  readonly runtime: BlackboxAttemptRuntime;
  readonly policy: BlackboxFixturePolicy;
  readonly testInfo: TestInfo;
  readonly step: <Value>(title: string, operation: () => Promise<Value>) => Promise<Value>;
  readonly use: (attempt: RunningBlackboxAttempt) => Promise<void>;
}

type AcquiredAttempt =
  | { readonly kind: 'pending' }
  | { readonly kind: 'acquired'; readonly attempt: RunningBlackboxAttempt };
type AttemptPhase = 'starting' | 'using';

interface AcquiredAttemptState {
  current: AcquiredAttempt;
}

function pendingAttempt(): AcquiredAttemptState {
  return { current: { kind: 'pending' } };
}

const startSandboxStep = 'Start sandbox';
const cleanUpSandboxStep = 'Clean up sandbox';

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
  await reported(report, 'teardown', `reason=${reason}; cleanup owned resources`, () =>
    stopWithinCleanupTimeout({
      attempt,
      reason,
      cleanupTimeoutMs: policy.sandboxCleanupTimeoutMs,
    }),
  );
  await reportObservations(report, attempt);
}

async function startAttempt(
  input: AttemptFixtureInput,
  report: AttemptReport,
  acquired: AcquiredAttemptState,
): Promise<void> {
  await input.step(startSandboxStep, async () => {
    const attempt = await acquireWithinTestTimeout({
      runtime: input.runtime,
      testInfo: input.testInfo,
      cleanupTimeoutMs: input.policy.sandboxCleanupTimeoutMs,
      cleanupStep: (operation) => input.step(cleanUpSandboxStep, operation),
      request: {
        selection: input.catalogEntry,
        configFile: configFilePath(input.testInfo),
        environment: input.blackboxEnvironment,
        artifactDirectory: input.testInfo.outputPath('blackbox'),
        progress: report,
      },
    });
    acquired.current = { kind: 'acquired', attempt };
    report.acquired(attempt.sandbox, attempt.telemetry);
    bindEffectAssertionReporter(attempt.effects, report);
    report.emit(
      'sandbox',
      'completed',
      `${attempt.sandbox.sandboxId}; ${attempt.sandbox.entrypoint.url}`,
    );
    await report.flush();
  });
}

async function cleanUpAttempt(
  input: AttemptFixtureInput,
  report: AttemptReport,
  attempt: RunningBlackboxAttempt,
  phase: AttemptPhase,
): Promise<void> {
  closeBlackboxEffects(attempt.effects);
  const reason = phase === 'using' ? stopReason(input.testInfo.status) : 'failed';
  report.emit('execution', 'info', input.testInfo.status ?? 'unknown');
  await input.step(cleanUpSandboxStep, () => finishAttempt(attempt, report, reason, input.policy));
}

async function useAttempt(input: AttemptFixtureInput, report: AttemptReport): Promise<void> {
  const acquired = pendingAttempt();
  let phase: AttemptPhase = 'starting';
  try {
    await startAttempt(input, report, acquired);
    if (acquired.current.kind !== 'acquired') {
      throw new Error('Blackbox sandbox acquisition did not return an attempt.');
    }
    report.emit('execution', 'started', 'test fixtures, hooks and body');
    phase = 'using';
    await input.use(acquired.current.attempt);
  } finally {
    if (acquired.current.kind === 'acquired') {
      await cleanUpAttempt(input, report, acquired.current.attempt, phase);
    }
  }
}

export async function runAttemptFixture(input: AttemptFixtureInput): Promise<void> {
  const report = new AttemptReport(input.testInfo);
  report.protect(input.blackboxEnvironment);
  try {
    await useAttempt(input, report);
  } catch (error) {
    report.emit('attempt', 'failed', 'setup or teardown failed; see test error');
    throw error;
  } finally {
    await report.finish();
  }
}
