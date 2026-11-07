import {
  serializeEffectSnapshot as serialize, type EffectRecorder, type EffectSnapshotOptions,
} from '@suites/blackbox-effects';

import { recorderOwner } from './ownership.js';

/** A reviewed observation baseline still belongs to the capture's physical test attempt. */
export function serializeEffectSnapshot(recorder: EffectRecorder, options: EffectSnapshotOptions): string {
  const owner = recorderOwner(recorder);
  const reason = owner.unavailable();
  if (reason !== null) { throw new Error(`Effect snapshot unavailable: ${reason}`); }
  return owner.redactSnapshot(serialize(recorder, options));
}
