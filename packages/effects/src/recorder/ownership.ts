import { snapshotGraph } from '../boundary/graph.js';
import { freezeOwned, snapshotJson } from '../boundary/ownership.js';
import { fields, items, text } from '../boundary/values.js';
import type { EffectGraph, EffectSelection } from '../graph/model.js';
import type { EffectCaptureInput, EffectCaptureIdentity, EffectRecorder } from './model.js';

export interface CaptureState {
  readonly identity: EffectCaptureIdentity;
  readonly graph: EffectGraph | null;
  readonly unavailableReason: string | null;
}

export interface RecorderState {
  readonly capture: CaptureState;
  readonly selection: EffectSelection;
}

const recorders = new WeakMap<EffectRecorder, RecorderState>();

function identity(value: EffectCaptureIdentity): EffectCaptureIdentity {
  const input = fields(
    snapshotJson(value, 'reject'),
    ['sessionId', 'executionId', 'scopeId', 'captureId', 'activityIds'],
    'capture.identity',
  );
  const activityIds = items(input.activityIds, (id) => text(id, 'activityId'), 'activityIds');
  if (new Set(activityIds).size !== activityIds.length) {
    throw new TypeError('Capture activity identities must be unique');
  }
  return {
    sessionId: text(input.sessionId, 'sessionId'),
    executionId: text(input.executionId, 'executionId'),
    scopeId: text(input.scopeId, 'scopeId'),
    captureId: text(input.captureId, 'captureId'),
    activityIds,
  };
}

export function captureState(input: EffectCaptureInput): CaptureState {
  const ownedIdentity = identity(input.identity);
  if ('unavailable' in input) {
    if ('graph' in input) {
      throw new TypeError('A capture cannot be both available and unavailable');
    }
    return freezeOwned({
      identity: ownedIdentity,
      graph: null,
      unavailableReason: text(input.unavailable.reason, 'unavailable.reason'),
    });
  }
  const graph = snapshotGraph(input.graph);
  if (graph.scope.id !== ownedIdentity.scopeId) {
    throw new TypeError('Capture scope identity does not match its graph');
  }
  return freezeOwned({ identity: ownedIdentity, graph, unavailableReason: null });
}

export function ownRecorder(recorder: EffectRecorder, state: RecorderState): EffectRecorder {
  recorders.set(recorder, state);
  return recorder;
}

export function recorderState(recorder: EffectRecorder): RecorderState {
  const state = recorders.get(recorder);
  if (state === undefined) {
    throw new TypeError('Expected an effect recorder owned by an immutable capture');
  }
  return state;
}
