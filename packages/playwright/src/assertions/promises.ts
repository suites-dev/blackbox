import type { Consumption } from './context.js';

/** Promise proxy forces await assimilation to observe consumption without changing outcomes. */
export function consumptionPromise<Value>(promise: Promise<Value>, state: Consumption): Promise<Value> {
  // The owning scope reports unconsumed rejection; prevent a second unhandled-rejection channel.
  void promise.catch(() => undefined);
  return new Proxy(promise, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (property === 'then' || property === 'catch' || property === 'finally') {
        return (...args: unknown[]) => {
          state.consumed = true;
          const method: unknown = Reflect.get(target, property, target);
          if (typeof method !== 'function') { throw new TypeError('Invalid native Promise method'); }
          const result: unknown = Reflect.apply(method, target, args);
          return result;
        };
      }
      if (typeof value !== 'function') { return value; }
      const bound: unknown = value.bind(target);
      return bound;
    },
  });
}
