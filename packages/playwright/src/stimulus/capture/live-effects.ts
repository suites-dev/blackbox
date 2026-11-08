import type { EffectCapture } from '@suites/blackbox-effects';
import type { BlackboxEffects } from '../../types.js';
import type { CaptureLease, CaptureOperations } from '../../capture/operations.js';
import { captureAttemptActivity } from '../../effects/attempt-effects.js';
import { bindCapturedEffects } from '../../effects/runtime.js';
import { effectAttemptOwner } from '../../effects/emissions/attempt-owner.js';
import { ownEffectCapture, recorderOwner } from '../../effects/emissions/ownership.js';
import { lazyEffectCapture } from '../../effects/emissions/lazy/selection.js';
import type { CapturedEffects } from '../../effects/emissions/capture.js';
import type { AttemptReport } from '../../reporting/attempt.js';
import { linkClaim } from '../../assertions/claims/context.js';
import { boundedEffectGraph } from './effects.js';

type Digest = Awaited<ReturnType<AttemptReport['executionArtifact']>>;

export interface StimulusCutReference {
  readonly captureId: string;
  readonly reference: Digest;
  readonly purpose: 'initial' | 'assertion' | 'explicit';
}
interface Input {
  readonly effects: BlackboxEffects;
  readonly executionId: string;
  readonly activityId: string;
  readonly report: AttemptReport;
  readonly operations: CaptureOperations;
  readonly record: (cut: StimulusCutReference) => void;
}
interface StoredCut {
  readonly captured: CapturedEffects;
  reference: Promise<Digest> | null;
}

/** Preserve the initial cut; each later matcher owns and retains its own terminal read. */
export function liveStimulusEffects(input: Input) {
  const cuts = new WeakMap<EffectCapture, StoredCut>();
  const ownerUnavailable = effectAttemptOwner();
  function check(): void {
    const reason = ownerUnavailable();
    if (reason !== null) { throw new Error(reason); }
    input.operations.check();
  }
  async function retain(capture: EffectCapture, purpose: StimulusCutReference['purpose'], lease: CaptureLease): Promise<Digest> {
    check(); lease.check();
    const stored = cuts.get(capture);
    if (stored === undefined || stored.captured.graph === undefined) { throw new Error('Unknown stimulus effect cut'); }
    stored.reference ??= input.report.executionArtifact('stimulus-effects', {
      schemaVersion: 1, kind: 'stimulus-effects', executionId: input.executionId,
      identity: capture.identity, coverage: capture.coverage, evidence: stored.captured.evidence,
      ...boundedEffectGraph(stored.captured.graph),
    }, lease).then((reference) => {
      lease.check();
      input.record({ captureId: capture.identity.captureId, reference, purpose });
      return reference;
    });
    const reference = await stored.reference;
    lease.check();
    linkClaim(input.report, reference);
    return reference;
  }
  return lazyEffectCapture({
    check,
    async run(operation) {
      check();
      // Keep a poll registered during its retry delay. Assertion failures are not capture failures.
      const result = await input.operations.run(async (lease) => {
        try { const value = await operation(); lease.check(); return { kind: 'value' as const, value }; }
        catch (error) { lease.check(); return { kind: 'error' as const, error }; }
      });
      if (result.kind === 'error') { throw result.error; }
      return result.value;
    },
    read(timeoutMs) {
      check();
      return input.operations.run(async (lease) => {
        const captured = await captureAttemptActivity(input.effects, input.activityId);
        lease.check();
        const bound = bindCapturedEffects(input.effects, captured);
        const capture = ownEffectCapture(captured.capture, {
          ...recorderOwner(bound.span()),
          report: (report) => input.operations.run(async (reportLease) => {
            const captureReference = await retain(capture, 'assertion', reportLease);
            await input.report.emissionAssertion({ ...report, captureReference }, reportLease);
          }),
        });
        cuts.set(capture, { captured, reference: null });
        return capture;
      }, { timeoutMs });
    },
    retain: (capture) => input.operations.run(async (lease) => { await retain(capture, 'explicit', lease); }),
  });
}
