import { expect, mergeTests, test as base } from '@playwright/test';

import { createBlackboxTest } from '../../fixtures.js';
import { record, systemSandboxRuntime } from './runtime.fixture.js';

const test = createBlackboxTest(systemSandboxRuntime);
const extended = test.extend<{ tenant: string }>({
  tenant: async ({ baseURL: _baseURL }, use) => use('alpha'),
});
const auxiliary = base.extend<{ audit: string }>({
  audit: async ({ baseURL: _baseURL }, use) => use('native-merge'),
});
const merged = mergeTests(extended, auxiliary);

merged.describe('native parent', { tag: '@acceptance' }, () => {
  merged.use({
    blackbox: {
      system: { kind: 'system', id: 'parent' },
      environment: { PARENT: 'present' },
      clients: {},
      retainAttempts: false,
      finalSnapshot: false,
    },
  });
  merged.beforeAll(() => {
    record({ kind: 'nested-before-all' });
  });
  merged.afterAll(() => {
    record({ kind: 'nested-after-all' });
  });
  merged.beforeEach(({ tenant, audit, sandbox }) => {
    expect(tenant).toBe('alpha');
    expect(audit).toBe('native-merge');
    record({ kind: 'merged-hook', executionId: sandbox.executionId });
  });
  merged(
    'native tags and merged fixture values survive',
    { tag: '@native' },
    ({ tenant, audit }, info) => {
      expect(tenant).toBe('alpha');
      expect(audit).toBe('native-merge');
      expect(info.tags).toEqual(['@acceptance', '@native']);
      record({ kind: 'merged-body' });
    },
  );
  merged.describe('native child', () => {
    merged.use({ blackbox: { system: { kind: 'subsystem', id: 'child' } } });
    merged('nested options replace the entire blackbox value', ({ blackbox, sandbox }) => {
      expect(blackbox).toEqual({ system: { kind: 'subsystem', id: 'child' } });
      expect(sandbox.catalogEntry).toEqual({ kind: 'subsystem', id: 'child' });
      record({ kind: 'replacement-body' });
    });
  });
});
