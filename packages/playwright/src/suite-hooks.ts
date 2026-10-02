import type { TestInfo } from '@playwright/test';

import type { RunningBlackboxAttempt } from './runtime/acquisition.js';
import type { AttemptTraceContext } from './trace/trace-context.js';
import type { BlackboxSandbox } from './types.js';

type SuiteHook = 'beforeAll' | 'afterAll';

/** The sandbox of one physical test attempt and the trace its requests join. */
export interface TestAttempt {
  readonly attempt: RunningBlackboxAttempt;
  readonly trace: AttemptTraceContext;
  readonly exec: BlackboxSandbox['exec'];
}

/** Stands in for the attempt while a beforeAll/afterAll hook resolves fixtures. */
export interface SuiteHookScope {
  readonly suiteHook: SuiteHook;
}

/**
 * Playwright resolves baseURL for every beforeAll/afterAll hook through its own
 * auto fixtures, so an attempt acquired there would be a whole extra sandbox that
 * no test uses. Playwright exposes the hook slot only internally, and uses the
 * same check to refuse page and context in these hooks.
 */
export function suiteHook(testInfo: TestInfo): SuiteHook | 'none' {
  const currentHookType: unknown = Reflect.get(testInfo, '_currentHookType');
  if (typeof currentHookType !== 'function') {
    return 'none';
  }
  const current: unknown = Reflect.apply(currentHookType, testInfo, []);
  return current === 'beforeAll' || current === 'afterAll' ? current : 'none';
}

export function testAttempt(
  attempt: TestAttempt | SuiteHookScope,
  fixture: 'sandbox' | 'telemetry' | 'effects',
): TestAttempt {
  if ('suiteHook' in attempt) {
    throw new Error(
      `Blackbox fixture "${fixture}" is not available in ${attempt.suiteHook} hooks: ` +
        'each test attempt owns its own sandbox. Use it in beforeEach, afterEach or the test.',
    );
  }
  return attempt;
}
