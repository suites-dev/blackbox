import type { EffectRecorder, EffectRecorderAssessment } from '@suites/blackbox-effects';
import { setTimeout as delay } from 'node:timers/promises';
import { recorderOwner } from '../ownership.js';
import { lazySelection } from './selection.js';
import type { EmissionSelection } from './types.js';

export type EmissionEvaluation = (recorder: EffectRecorder, other?: EffectRecorder) => EffectRecorderAssessment;
function assess(recorder: EffectRecorder, other: EffectRecorder | undefined, evaluate: EmissionEvaluation) {
  const reason = recorderOwner(recorder).unavailable() ?? (other === undefined ? null : recorderOwner(other).unavailable());
  const assessment: EffectRecorderAssessment = reason === null ? evaluate(recorder, other) : {
    status: 'inconclusive', reason, identity: recorder.identity, coverage: recorder.coverage,
    evidence: [], possibleEvidence: [], relations: [],
  };
  return { recorder, other, assessment };
}

/** One ordering comparison always selects both operands from the very same immutable cut. */
export async function resolveEmission(input: {
  readonly recorder: EmissionSelection;
  readonly timeout: number;
  readonly evaluate: EmissionEvaluation;
} & Readonly<Partial<{ other: EmissionSelection }>>) {
  const selection = lazySelection(input.recorder);
  const other = input.other === undefined ? undefined : lazySelection(input.other);
  if (selection === undefined) {
    if (other !== undefined) { throw new TypeError('Cannot compare a frozen capture with a lazy effect selection'); }
    return assess(input.recorder as EffectRecorder, input.other as EffectRecorder | undefined, input.evaluate);
  }
  if (input.other !== undefined && (other === undefined || other.provider !== selection.provider)) {
    throw new TypeError('Lazy effect ordering requires selections from the same stimulus');
  }
  const provider = selection.provider;
  const deadline = performance.now() + Math.max(0, input.timeout);
  let last: ReturnType<typeof assess> | undefined;
  for (;;) {
    provider.check();
    const remaining = deadline - performance.now();
    // Do not turn the final polling interval into a sub-millisecond capture deadline.
    if (last !== undefined && remaining <= 50) {
      if (remaining > 0) { await delay(Math.ceil(remaining)); }
      provider.check();
      return last;
    }
    const capture = await provider.read(Math.max(1, deadline - performance.now()));
    provider.check();
    const result = assess(selection.select(capture), other === undefined ? undefined : other.select(capture), input.evaluate);
    if (result.assessment.status !== 'inconclusive' || performance.now() >= deadline) { return result; }
    last = result;
    await delay(Math.ceil(Math.min(50, Math.max(1, deadline - performance.now()))));
    provider.check();
    if (performance.now() >= deadline) { return result; }
  }
}
