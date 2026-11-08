import type { EffectCapture } from '@suites/blackbox-effects';
import { lazySelection } from '../../../effects/emissions/lazy/selection.js';
import type { LazyEffectRecorder } from '../../../effects/emissions/lazy/types.js';
import { deferred } from '../evidence.fixture.js';

/** Observe real provider reads; preserve the exact collector-backed cut and ownership checks. */
export function observeReads(handle: LazyEffectRecorder) {
  const selection = lazySelection(handle);
  if (selection === undefined) { throw new Error('Handle is not an authenticated lazy selection'); }
  const provider = selection.provider;
  const original = provider.read.bind(provider);
  const first = deferred<EffectCapture>();
  const cuts: EffectCapture[] = [];
  let started = 0;
  const read = async (timeout: number) => {
    started++;
    const cut = await original(timeout);
    cuts.push(cut); first.resolve(cut);
    return cut;
  };
  if (!Reflect.set(provider, 'read', read)) { throw new Error('Cannot observe actual provider reads'); }
  return { first: first.promise, cuts, started: () => started, restore: () => {
    if (!Reflect.set(provider, 'read', original)) { throw new Error('Cannot restore provider read'); }
  } };
}
