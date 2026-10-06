import { expect, it } from 'vitest';

import BlackboxReporter from '../reporter.js';
import { policyOption, sandboxLifecycleEnabled } from './options.js';

it('reads lifecycle output from runner metadata without shared state', () => {
  expect(sandboxLifecycleEnabled({ metadata: { blackboxSandboxLifecycle: true } })).toBe(true);
  expect(sandboxLifecycleEnabled({ metadata: { blackboxSandboxLifecycle: false } })).toBe(false);
  expect(sandboxLifecycleEnabled({ metadata: {} })).toBe(false);
  expect(new BlackboxReporter().printsToStdio()).toBe(false);
});

it('rejects mistyped lifecycle options instead of silently enabling output', () => {
  expect(() => new BlackboxReporter({ sandboxLifecycle: 'false' })).toThrow('must be a boolean');
});

it('reads runner-policy paths and rejects values that would silently skip verification', () => {
  expect(policyOption({})).toEqual({ baseline: null, outputFile: null });
  expect(policyOption({ sandboxLifecycle: false })).toEqual({ baseline: null, outputFile: null });
  expect(
    policyOption({ policy: { baseline: './policy.json', outputFile: 'out/policy.json' } }),
  ).toEqual({ baseline: './policy.json', outputFile: 'out/policy.json' });
  expect(policyOption({ policy: { outputFile: 'out.json' } })).toEqual({
    baseline: null,
    outputFile: 'out.json',
  });
  expect(() => policyOption({ policy: { baseline: '' } })).toThrow(
    'policy.baseline must be a non-empty path',
  );
  expect(() => policyOption({ policy: { baseline: 1 } })).toThrow('policy.baseline');
  expect(() => policyOption({ policy: { outputFile: ' ' } })).toThrow('policy.outputFile');
  expect(() => policyOption({ policy: 'policy.json' })).toThrow('policy must be an object');
  // @ts-expect-error Exercise a JavaScript consumer passing an invalid option.
  expect(() => new BlackboxReporter({ policy: { baseline: false } })).toThrow('policy.baseline');
});
