import { AsyncLocalStorage } from 'node:async_hooks';

import type { Fixtures, TestInfo, TestType } from '@playwright/test';

const bodies = new WeakSet<TestInfo>();
const lifecycle = new AsyncLocalStorage<'hook' | 'fixture'>();

/** Neutral execution phase: lifecycle and inspection SDKs do not become actions. */
export function isTestBody(testInfo: TestInfo): boolean {
  return bodies.has(testInfo) && lifecycle.getStore() === undefined;
}

export function registerBodyEnd<TestArgs extends object, WorkerArgs extends object>(
  test: TestType<TestArgs, WorkerArgs>,
): void {
  // Native fixture introspection requires destructuring even without dependencies.
  // eslint-disable-next-line no-empty-pattern
  test.afterEach(({}, info) => {
    bodies.delete(info);
  });
}

export function registerBodyStart<TestArgs extends object, WorkerArgs extends object>(
  test: TestType<TestArgs, WorkerArgs>,
): void {
  // Native fixture introspection requires destructuring even without dependencies.
  // eslint-disable-next-line no-empty-pattern
  test.beforeEach(({}, info) => {
    bodies.add(info);
  });
}

/** Keep the original fixture signature while scoping only execution, not registration. */
export function lifecycleCallback<T extends (...args: never[]) => unknown>(
  callback: T,
  kind: 'hook' | 'fixture',
): T {
  return new Proxy(callback, {
    get(target, property, receiver) {
      if (property === 'toString') {
        return target.toString.bind(target);
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
    apply(target, receiver: unknown, args: unknown[]) {
      const invoke = [...args];
      if (kind === 'fixture' && typeof args[1] === 'function') {
        const use = args[1] as (...values: unknown[]) => unknown;
        invoke[1] = (...values: unknown[]) => lifecycle.exit(() => use(...values));
      }
      return lifecycle.run(kind, () => Reflect.apply(target, receiver, invoke) as unknown);
    },
  });
}

export function lifecycleFixtures<
  T extends object,
  W extends object,
  A extends object,
  B extends object,
>(fixtures: Fixtures<T, W, A, B>): Fixtures<T, W, A, B> {
  return Object.fromEntries(
    Object.entries(fixtures).map(([name, value]: [string, unknown]) => {
      const tuple = Array.isArray(value) && typeof value[1] === 'object';
      const callback: unknown = tuple ? value[0] : value;
      if (typeof callback !== 'function') {
        return [name, value];
      }
      const wrapped = lifecycleCallback(callback as (...args: never[]) => unknown, 'fixture');
      return [name, tuple ? [wrapped, value[1]] : wrapped];
    }),
  ) as Fixtures<T, W, A, B>;
}
