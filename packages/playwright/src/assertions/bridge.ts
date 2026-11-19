import { createRequire } from 'node:module';
import { AssertionScopeError } from './types.js';

export const assertionAccountingPlaywrightVersion = '1.64.1';
const require = createRequire(import.meta.url);
export function installedPlaywrightVersion(): string {
  const manifest: unknown = require('@playwright/test/package.json');
  return typeof manifest === 'object' && manifest !== null && 'version' in manifest &&
    typeof manifest.version === 'string' ? manifest.version : '';
}

export type NativeCompletionObserver = (result: unknown) => void;
export type NativeStepObserver = (data: unknown) => NativeCompletionObserver | null;

function unsupported(): AssertionScopeError {
  return new AssertionScopeError('unsupported', {
    total: 0, passed: 0, failed: 0, pending: 0, unconsumed: 0,
  });
}

/** Isolated private bridge, qualified only for the exact pinned Playwright version. */
export function installAssertionBridge(target: object, version: string, observe: NativeStepObserver) {
  if (version !== assertionAccountingPlaywrightVersion) { throw unsupported(); }
  const original: unknown = Reflect.get(target, '_addStep');
  if (typeof original !== 'function') { throw unsupported(); }
  const descriptor = Object.getOwnPropertyDescriptor(target, '_addStep');
  const replacement = function (this: unknown, ...args: unknown[]): unknown {
    const completion = observe(args[0]);
    const step: unknown = Reflect.apply(original, this, args);
    if (completion === null) { return step; }
    if (typeof step !== 'object' || step === null) { throw unsupported(); }
    const complete: unknown = Reflect.get(step, 'complete');
    if (typeof complete !== 'function') { throw unsupported(); }
    let finished = false;
    const wrappedComplete = function (this: unknown, result: unknown): unknown {
      let value: unknown;
      try { value = Reflect.apply(complete, this, [result]); }
      finally {
        if (!finished) {
          finished = true;
          // Native completion can inherit an infecting soft error from a child step.
          const directError: unknown = typeof result === 'object' && result !== null
            ? Reflect.get(result, 'error') : undefined;
          const inheritedError: unknown = Reflect.get(step, 'error');
          const normalized = typeof result === 'object' && result !== null
            ? { ...result, error: directError ?? inheritedError } : result;
          completion(normalized);
        }
      }
      return value;
    };
    if (!Reflect.set(step, 'complete', wrappedComplete) || Reflect.get(step, 'complete') !== wrappedComplete) {
      throw unsupported();
    }
    return step;
  };
  if (!Reflect.set(target, '_addStep', replacement) || Reflect.get(target, '_addStep') !== replacement) {
    throw unsupported();
  }
  return () => {
    if (Reflect.get(target, '_addStep') !== replacement) { throw unsupported(); }
    if (descriptor === undefined) { Reflect.deleteProperty(target, '_addStep'); }
    else { Object.defineProperty(target, '_addStep', descriptor); }
  };
}
