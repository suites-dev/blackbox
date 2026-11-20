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
  readonly snapshotEnabled: boolean;
  readonly testInfo: TestInfo;
  readonly configFile: string;
  readonly entryId: string;
  readonly variables: Readonly<Record<string, string>>;
}

/**
 * Starts reading the source, catalog and environment once the test body has finished, beside sandbox cleanup.
 * Reading them when the attempt begins put git and Docker subprocesses inside the test's own timeout budget (a
 * test with a 100 ms timeout failed 6 of 8 times under CPU load). The cost is that a test which edits tracked
 * files changes the recorded source. It never rejects; the envelope waits for it.
 */
export function startPreludeCapture(input: FinalCaptureInput): Promise<EnvelopePrelude | null> {
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
): Promise<{ readonly snapshot: FinalSnapshotDocument | null; readonly failure: Error | null }> {
  try {
    const collected = await collectFinalSnapshot({ testInfo: input.testInfo, ...captured });
    const snapshot = input.snapshotEnabled ? await report.finalSnapshot(collected) : null;
    if (snapshot !== null) { report.emit('final-snapshot', 'completed', 'attached'); }
    const status = await captured.attempt.telemetry.inspect();
    const collector = collected.finalization.collector;
    const failed = status.kind !== 'disabled' && (collector.state !== 'found' ||
      collector.receiver !== 'stopped' || collector.shutdown !== 'complete' || collector.failure !== null ||
      ['unavailable', 'rejected', 'projection-rejected'].includes(collected.observation.state));
    if (report.hasStimulus()) {
      await report.executionArtifact('capture-health', { schemaVersion: 1, kind: 'capture-health',
        collector, observation: collected.observation, completeness: collected.completeness,
        status: status.kind === 'disabled' ? 'not-configured' : failed ? 'failed' : 'captured' });
    }
    return { snapshot, failure: failed ? new Error('Blackbox final collector capture failed') : null };
  } catch (cause) {
    report.emit('final-snapshot', 'failed', 'could not attach the final snapshot');
    throw new Error('Blackbox final snapshot capture failed', { cause });
  }
}

/** Final snapshot, then the envelope that wraps it. */
export async function attachFinalCapture(
  input: FinalCaptureInput,
  report: AttemptReport,
  captured: {
    readonly attempt: RunningBlackboxAttempt;
    readonly stimuli: CompletedStimuli;
    readonly recorded: RecordedStimuli;
    readonly stopReason: SandboxStopReason;
    readonly prelude: Promise<EnvelopePrelude | null>;
    readonly product: AttemptProduct;
  },
): Promise<Digest | null> {
  if (!input.enabled) {
    return null;
  }
  let snapshot: FinalSnapshotDocument | null = null;
  let snapshotError: unknown = null;
  try {
    const result = await snapshotOf(input, report, captured);
    snapshot = result.snapshot;
    snapshotError = result.failure;
  } catch (error) { snapshotError = error; }
  const prelude = await captured.prelude;
  if (prelude === null) {
    report.emit('envelope', 'failed', 'catalog, source or environment could not be captured');
    if (snapshotError !== null) { throw new AggregateError([snapshotError, new Error('Blackbox envelope prelude capture failed')], 'Blackbox capture failed'); }
    throw new Error('Blackbox envelope prelude capture failed');
  }
  let digest: Digest;
  try {
    const envelope = await buildAttemptEnvelope({
      testInfo: input.testInfo,
      prelude,
      attempt: captured.attempt,
      snapshot,
      recorded: report.redactStimuli(captured.recorded),
      attached: report.attachedEvidence(),
      attemptFailed: captured.product.cleanupFailed || captured.product.executionFailed || snapshotError !== null,
    });
    await input.testInfo.attach(envelopeAttachment, {
      contentType: 'application/json',
      body: JSON.stringify(envelope),
    });
    report.emit('envelope', 'completed', envelope.digest);
    captured.product.envelope = envelope.digest;
    digest = envelope.digest;
  } catch (cause) {
    report.emit('envelope', 'failed', 'could not build or attach the envelope');
    if (snapshotError !== null) { throw new AggregateError([snapshotError, cause], 'Blackbox capture failed'); }
    throw new Error('Blackbox envelope capture failed', { cause });
  }
  if (snapshotError !== null) { throw new Error('Blackbox final snapshot capture failed', { cause: snapshotError }); }
  return digest;
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
  readonly prelude: Promise<EnvelopePrelude | null>;
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
        product: input.product,
      }),
  });
}
