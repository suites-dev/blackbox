import { freezeOwned } from '../boundary/ownership.js';
import { effectContractBuilder, type EffectSelector } from '../contract.js';
import { select } from '../verification/selectors.js';
import type { EffectCapture, EffectCaptureInput, EffectRecorder } from './model.js';
import { captureState, ownRecorder, type CaptureState } from './ownership.js';

function metadata(state: CaptureState) {
  return {
    identity: state.identity,
    available: state.graph !== null,
    unavailableReason: state.unavailableReason,
    coverage:
      state.graph === null
        ? {
            closed: false,
            coverage: 'unknown' as const,
            orderCoverage: 'unknown' as const,
            reasons: [state.unavailableReason ?? 'observation unavailable'],
            attestation: 'none',
          }
        : { closed: state.graph.scope.closed, ...state.graph.quality },
  };
}

function recorder(state: CaptureState, selector: EffectSelector): EffectRecorder {
  const selection =
    state.graph === null ? { definite: [], possible: [] } : select(state.graph, selector);
  const owned = freezeOwned({
    ...metadata(state),
    selector,
    emissions: selection.definite,
    possibleEmissions: selection.possible,
  });
  return ownRecorder(owned, { capture: state, selection });
}

/** Capture one detached graph; later telemetry reads and caller mutations cannot alter its emissions. */
export function createEffectCapture(input: EffectCaptureInput): EffectCapture {
  const state = captureState(input);
  return freezeOwned({
    ...metadata(state),
    http: (fields) => recorder(state, effectContractBuilder.http(fields)),
    rpc: (fields) => recorder(state, effectContractBuilder.rpc(fields)),
    db: (fields) => recorder(state, effectContractBuilder.db(fields)),
    cache: (fields) => recorder(state, effectContractBuilder.cache(fields)),
    message: (fields) => recorder(state, effectContractBuilder.message(fields)),
    business: (fields) => recorder(state, effectContractBuilder.business(fields)),
    internal: (fields) => recorder(state, effectContractBuilder.internal(fields)),
    span: (fields) => recorder(state, effectContractBuilder.span(fields)),
  } satisfies EffectCapture);
}
