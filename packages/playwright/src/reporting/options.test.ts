import { expect, it } from 'vitest';

import BlackboxReporter from '../reporter.js';
import { sandboxLifecycleEnabled } from './options.js';

it('reads lifecycle output from runner metadata without shared state', () => {
  expect(sandboxLifecycleEnabled({ metadata: { blackboxSandboxLifecycle: true } })).toBe(true);
  expect(sandboxLifecycleEnabled({ metadata: { blackboxSandboxLifecycle: false } })).toBe(false);
  expect(sandboxLifecycleEnabled({ metadata: {} })).toBe(false);
  expect(new BlackboxReporter().printsToStdio()).toBe(false);
});

it('rejects mistyped lifecycle options instead of silently enabling output', () => {
  expect(() => new BlackboxReporter({ sandboxLifecycle: 'false' })).toThrow('must be a boolean');
});
