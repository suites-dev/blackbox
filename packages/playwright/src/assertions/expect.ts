import { samplingContext, scopeContext, type AssertionScopeState } from './context.js';
import { activeInvocationScope, beginInvocation, invokeTracked, retryCallback } from './invocation.js';

interface MatcherSession {
  readonly actual: unknown;
  readonly captured: AssertionScopeState | null;
  readonly poll: boolean;
  readonly create: (actual: unknown) => unknown;
}

function call(target: unknown, receiver: unknown, args: unknown[]): unknown {
  if (typeof target !== 'function') { throw new TypeError('Invalid native expect operation'); }
  const value: unknown = Reflect.apply(target, receiver, args);
  return value;
}

function atPath(value: unknown, path: readonly PropertyKey[]): unknown {
  let current = value;
  for (const property of path) {
    if (typeof current !== 'object' || current === null) { throw new TypeError('Invalid native matcher chain'); }
    current = Reflect.get(current, property);
  }
  return current;
}

function invokeMatcher(input: {
  readonly session: MatcherSession; readonly path: readonly PropertyKey[];
  readonly target: object; readonly method: string; readonly args: unknown[];
}): unknown {
  const scope = activeInvocationScope(input.session.captured);
  const original: unknown = Reflect.get(input.target, input.method);
  if (scope === null) { return call(original, input.target, input.args); }
  const invocation = beginInvocation(scope, input.method, input.session.poll);
  return invokeTracked(invocation, () => {
    if (input.method !== 'toPass' || typeof input.session.actual !== 'function') {
      return call(original, input.target, input.args);
    }
    const actual = input.session.actual;
    const callback = retryCallback((...args) => call(actual, undefined, args), invocation);
    const rebuilt = atPath(input.session.create(callback), input.path);
    if (typeof rebuilt !== 'object' || rebuilt === null) { throw new TypeError('Invalid native toPass matcher'); }
    return call(Reflect.get(rebuilt, input.method), rebuilt, input.args);
  });
}

function matcherTree(target: unknown, session: MatcherSession, path: readonly PropertyKey[]): unknown {
  if (typeof target !== 'object' || target === null) { return target; }
  return new Proxy(target, {
    get(object, property) {
      const value: unknown = Reflect.get(object, property, object);
      if (property === 'not' || property === 'resolves' || property === 'rejects') {
        return matcherTree(value, session, [...path, property]);
      }
      if (typeof value !== 'function' || typeof property !== 'string') { return value; }
      return (...args: unknown[]) => invokeMatcher({ session, path, target: object, method: property, args });
    },
  });
}

function createMatcherSession(target: unknown, receiver: unknown, args: unknown[], poll: boolean): unknown {
  const actual = args[0];
  const sampled = poll && typeof actual === 'function'
    ? (...values: unknown[]) => samplingContext.run(true, () => call(actual, undefined, values))
    : actual;
  const create = (value: unknown) => call(target, receiver, [value, ...args.slice(1)]);
  const result = create(sampled);
  return matcherTree(result, { actual: sampled, captured: scopeContext.getStore() ?? null, poll, create }, []);
}

/** Keeps native call signatures and extension types while accounting only inside owned scopes. */
export function accountingExpect<Native extends object>(native: Native): Native {
  return new Proxy(native, {
    apply(target, receiver, args: unknown[]) {
      return createMatcherSession(target, receiver, args, false);
    },
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (property === 'soft') {
        if (typeof value !== 'function') { throw new TypeError('Invalid native soft expect'); }
        return accountingExpect(value);
      }
      if (property === 'configure' || property === 'extend') {
        return (...args: unknown[]) => {
          const result = call(value, target, args);
          if (typeof result !== 'function') { throw new TypeError('Invalid configured native expect'); }
          return accountingExpect(result);
        };
      }
      if (property === 'poll') {
        return (...args: unknown[]) => createMatcherSession(value, target, args, true);
      }
      return value;
    },
  });
}
