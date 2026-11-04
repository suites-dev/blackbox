import type { TestInfo } from '@playwright/test';
import { readCollectorLifecycle } from '@suites/blackbox-otel-collector';
import { sandboxTelemetryStorageDirectory, type SandboxStopReason } from '@suites/blackbox-sandbox';

import type { CompletedStimuli } from '../../activities/execution/attempt-stimuli.js';
import {
  createScopedObservationSource,
  type ScopedObservationReadResult,
} from '../../activities/scoped-observations.js';
import {
  buildFinalSnapshot,
  type CollectorFinalization,
  type FinalSnapshotDocument,
} from '../../effects/final-snapshot.js';
import type { RunningBlackboxAttempt } from '../../runtime/acquisition.js';

export async function readCollectorFinalization(
  input: { readonly sessionId: string; readonly executionId: string },
  storageDirectory: string,
): Promise<CollectorFinalization> {
  try {
    const result = await readCollectorLifecycle({
      sessionId: input.sessionId,
      executionId: input.executionId,
      storageDirectory,
    });
    if (result.kind === 'collector-lifecycle-missing') {
      return { state: 'missing', message: result.message };
    }
    if (result.kind === 'collector-lifecycle-corrupt') {
      return { state: 'corrupt', message: 'Retained collector lifecycle is corrupt.' };
    }
    const run = result.lifecycle.runs.at(-1);
    if (run === undefined) {
      return { state: 'missing', message: 'The collector recorded no run.' };
    }
    return {
      state: 'found',
      receiver: run.receiver,
      shutdown: run.shutdown,
      acceptedRequests: result.lifecycle.telemetry.acceptedRequests,
      acceptedSpans: result.lifecycle.telemetry.acceptedSpans,
      activatedServices:
        run.instrumentation.kind === 'activated'
          ? [
              ...new Set(run.instrumentation.activations.map(({ serviceName }) => serviceName)),
            ].sort()
          : [],
      failure: run.failure === null ? null : 'recorded',
    };
  } catch {
    return { state: 'unreadable', message: 'Retained collector lifecycle could not be read.' };
  }
}

async function finalRead(
  stimuli: CompletedStimuli,
  storageDirectory: string,
): Promise<ScopedObservationReadResult | null> {
  if (stimuli.kind === 'none') {
    return null;
  }
  try {
    return await createScopedObservationSource({
      selection: stimuli.selection,
      storageDirectory,
    }).read();
  } catch {
    return { kind: 'unavailable', message: 'The final activity read failed.' };
  }
}

/**
 * Reads the attempt's own activities once, after sandbox cleanup, so the collector has stopped. It never
 * throws: a failed read is recorded as an explicit state, because a missing snapshot must not look like a
 * snapshot with no effects.
 */
export async function collectFinalSnapshot(input: {
  readonly testInfo: TestInfo;
  readonly attempt: Pick<RunningBlackboxAttempt, 'sandbox' | 'telemetry'>;
  readonly stimuli: CompletedStimuli;
  readonly stopReason: SandboxStopReason;
}): Promise<FinalSnapshotDocument> {
  const storageDirectory = sandboxTelemetryStorageDirectory({
    recordDirectory: input.attempt.sandbox.artifactDirectory,
    sandboxId: input.attempt.sandbox.sandboxId,
  });
  const { testInfo } = input;
  return buildFinalSnapshot({
    attempt: {
      testId: testInfo.testId,
      retry: testInfo.retry,
      status: testInfo.status ?? 'unknown',
      expectedStatus: testInfo.expectedStatus,
      errorCount: testInfo.errors.length,
      stopReason: input.stopReason,
    },
    collector: await readCollectorFinalization(input.attempt.telemetry, storageDirectory),
    stimuli:
      input.stimuli.kind === 'none'
        ? null
        : input.stimuli.selection.activities.map(({ activityId, purpose }) => ({
            activityId,
            purpose,
          })),
    read: await finalRead(input.stimuli, storageDirectory),
  });
}
