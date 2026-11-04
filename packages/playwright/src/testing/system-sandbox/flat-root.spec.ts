import { expect } from '@playwright/test';
import { createBlackboxTest } from '../../fixtures.js';
import { record, systemSandboxRuntime } from './runtime.fixture.js';

const test = createBlackboxTest(systemSandboxRuntime);

test('ordinary unselected tests retain native fixtures', ({ request }, info) => {
  expect(request).toBeDefined();
  expect(info.title).toBe('ordinary unselected tests retain native fixtures');
  record({ kind: 'ordinary-body' });
});
