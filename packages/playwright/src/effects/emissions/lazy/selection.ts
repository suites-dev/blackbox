import { effectContractBuilder, type EffectSelector } from '@suites/blackbox-effects';
import type { EmissionSelection, LazyEffectCapture, LazyEffectProvider, LazyEffectRecorder, LazySelection } from './types.js';

const selections = new WeakMap<LazyEffectRecorder, LazySelection>();
export function lazySelection(value: EmissionSelection): LazySelection | undefined {
  return selections.get(value as LazyEffectRecorder);
}

/** Selector construction is synchronous and cannot start telemetry I/O. */
export function lazyEffectCapture(provider: LazyEffectProvider): LazyEffectCapture {
  function remember(selector: EffectSelector): LazyEffectRecorder {
    const value = Object.freeze({ kind: 'lazy-effect-selection' as const, selector });
    const { node: _node, kind, ...fields } = selector;
    selections.set(value, { provider, select: (capture) => capture[kind ?? 'span'](fields) });
    return value;
  }
  return Object.freeze({
    http: (fields) => remember(effectContractBuilder.http(fields)),
    rpc: (fields) => remember(effectContractBuilder.rpc(fields)),
    db: (fields) => remember(effectContractBuilder.db(fields)),
    cache: (fields) => remember(effectContractBuilder.cache(fields)),
    message: (fields) => remember(effectContractBuilder.message(fields)),
    business: (fields) => remember(effectContractBuilder.business(fields)),
    internal: (fields) => remember(effectContractBuilder.internal(fields)),
    span: (fields) => remember(effectContractBuilder.span(fields)),
    capture() {
      return provider.run(async () => {
        provider.check();
        const capture = await provider.read(5_000);
        provider.check();
        await provider.retain(capture);
        provider.check();
        return capture;
      });
    },
  } satisfies LazyEffectCapture);
}
