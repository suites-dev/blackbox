import type { TestInfo } from '@playwright/test';
import type { SandboxStopReason } from '@suites/blackbox-sandbox';

import type { CompletedStimuli } from '../activities/execution/attempt-stimuli.js';
import type { Digest } from '../envelope/index.js';
import {
  completedAttemptStimuli,
  recordedAttemptStimuli,
  type RecordedStimuli,
} from '../effects/attempt-effects.js';
import { closeBlackboxEffects } from '../effects/runtime.js';
import type { FinalSnapshotDocument } from '../effects/final-snapshot.js';
import type { AttemptReport } from '../reporting/attempt.js';
import { buildAttemptEnvelope, envelopeAttachment } from '../reporting/capture/envelope.js';
import { captureEnvelopePrelude, type EnvelopePrelude } from '../reporting/capture/prelude.js';
import { collectFinalSnapshot } from '../reporting/capture/final-snapshot.js';
import type { RunningBlackboxAttempt } from '../runtime/acquisition.js';
import { finalizeAttempt, newAttemptProduct, type AttemptProduct } from './finalize.js';

export { newAttemptProduct, type AttemptProduct };
export type { EnvelopePrelude };

export interface FinalCaptureInput {
  readonly enabled: boolean;
  readonly testInfo: TestInfo;
  readonly configFile: string;
  readonly entryId: string;
  readonly variables: Readonly<Record<string, string>>;
}

/** Read before the attempt starts, so the source and configuration are the ones the test ran against. */
export function captureBeforeAttempt(input: FinalCaptureInput): Promise<EnvelopePrelude | null> {
  return input.enabled ? captureEnvelopePrelude(input) : Promise.resolve(null);
}

async function snapshotOf(
  input: FinalCaptureInput,
  report: AttemptReport,
  captured: {
    readonly attempt: RunningBlackboxAttempt;
    readonly stimuli: CompletedStimuli;
    readonly stopReason: SandboxStopReason;
  },
): Promise<FinalSnapshotDocument | null> {
  try {
    const snapshot = await collectFinalSnapshot({ testInfo: input.testInfo, ...captured });
    await report.finalSnapshot(snapshot);
    report.emit('final-snapshot', 'completed', 'attached');
    return snapshot;
  } catch {
    // A snapshot that cannot be attached is reported, never allowed to replace the test's own result.
    report.emit('final-snapshot', 'failed', 'could not attach the final snapshot');
    return null;
  }
}

/** Final snapshot, then the envelope that wraps it. Neither can fail the test. */
export async function attachFinalCapture(
  input: FinalCaptureInput,
  report: AttemptReport,
  captured: {
    readonly attempt: RunningBlackboxAttempt;
    readonly stimuli: CompletedStimuli;
    readonly recorded: RecordedStimuli;
    readonly stopReason: SandboxStopReason;
    readonly prelude: EnvelopePrelude | null;
  },
): Promise<Digest | null> {
  if (!input.enabled) {
    return null;
  }
  const snapshot = await snapshotOf(input, report, captured);
  if (captured.prelude === null) {
    report.emit('envelope', 'failed', 'catalog, source or environment could not be captured');
    return null;
  }
  try {
    const envelope = await buildAttemptEnvelope({
      testInfo: input.testInfo,
      prelude: captured.prelude,
      attempt: captured.attempt,
      snapshot,
      recorded: captured.recorded,
      attached: report.attachedEvidence(),
    });
    await input.testInfo.attach(envelopeAttachment, {
      contentType: 'application/json',
      body: JSON.stringify(envelope),
    });
    report.emit('envelope', 'completed', envelope.digest);
    return envelope.digest;
  } catch {
    report.emit('envelope', 'failed', 'could not build or attach the envelope');
    return null;
  }
}

/**
 * Ends an attempt: reads what its stimuli did, closes its effects, cleans up, and takes the final capture, in that
 * order. The capture is stored in `product` even when cleanup throws, and the cleanup error still propagates.
 */
export async function settleAttempt(input: {
  readonly capture: FinalCaptureInput;
  readonly report: AttemptReport;
  readonly attempt: RunningBlackboxAttempt;
  readonly stopReason: SandboxStopReason;
  readonly prelude: EnvelopePrelude | null;
  readonly product: AttemptProduct;
  readonly cleanup: () => Promise<void>;
}): Promise<void> {
  const { attempt } = input;
  const stimuli = completedAttemptStimuli(attempt.effects);
  const recorded = recordedAttemptStimuli(attempt.effects);
  closeBlackboxEffects(attempt.effects);
  // After cleanup the collector has stopped, so this read is final. It also runs when cleanup failed,
  // where the collector's own state is what the snapshot reports.
  await finalizeAttempt(input.product, {
    cleanup: input.cleanup,
    capture: () =>
      attachFinalCapture(input.capture, input.report, {
        attempt,
        stimuli,
        recorded,
        stopReason: input.stopReason,
        prelude: input.prelude,
      }),
  });
}
