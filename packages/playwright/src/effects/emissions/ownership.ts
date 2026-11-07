import type { EffectCapture, EffectRecorder } from '@suites/blackbox-effects';

import type { EmissionOwner } from './types.js';

const owners = new WeakMap<EffectRecorder, EmissionOwner>();

export function recorderOwner(recorder: EffectRecorder): EmissionOwner {
  const owner = owners.get(recorder);
  if (owner === undefined) {
    throw new TypeError('Received value is not an effect recorder owned by this Playwright attempt.');
  }
  return owner;
}

/** Selection factories keep the core recorder identity; ownership is held outside user-visible data. */
export function ownEffectCapture(capture: EffectCapture, owner: EmissionOwner): EffectCapture {
  const remember = <Recorder extends EffectRecorder>(recorder: Recorder): Recorder => {
    owners.set(recorder, owner);
    return recorder;
  };
  return Object.freeze({
    ...capture,
    http: (fields) => remember(capture.http(fields)),
    rpc: (fields) => remember(capture.rpc(fields)),
    db: (fields) => remember(capture.db(fields)),
    cache: (fields) => remember(capture.cache(fields)),
    message: (fields) => remember(capture.message(fields)),
    business: (fields) => remember(capture.business(fields)),
    internal: (fields) => remember(capture.internal(fields)),
    span: (fields) => remember(capture.span(fields)),
  } satisfies EffectCapture);
}
