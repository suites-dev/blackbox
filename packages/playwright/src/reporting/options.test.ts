import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

import BlackboxReporter from '../reporter.js';
import { sandboxLifecycleEnabled } from './options.js';

it('enables lifecycle output only for this configured reporter and respects opt-out', () => {
  const reporter = fileURLToPath(new URL('../reporter.js', import.meta.url));
  expect(sandboxLifecycleEnabled({ reporter: [[reporter]] })).toBe(true);
  expect(sandboxLifecycleEnabled({ reporter: [[reporter, { sandboxLifecycle: false }]] })).toBe(
    false,
  );
  expect(sandboxLifecycleEnabled({ reporter: [['list']] })).toBe(false);
  expect(sandboxLifecycleEnabled({ reporter: [['/another/reporter.js']] })).toBe(false);
  expect(new BlackboxReporter().printsToStdio()).toBe(false);
});

it('rejects mistyped lifecycle options instead of silently enabling output', () => {
  // @ts-expect-error Exercise a JavaScript consumer passing an invalid option.
  expect(() => new BlackboxReporter({ sandboxLifecycle: 'false' })).toThrow('must be a boolean');
});
