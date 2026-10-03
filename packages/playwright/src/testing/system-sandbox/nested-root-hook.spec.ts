import { createBlackboxSystemTest } from '../../fixtures.js';
import { systemSandboxRuntime } from './runtime.fixture.js';

const test = createBlackboxSystemTest(systemSandboxRuntime);

test.system('orders', (system) => {
  system.sandbox('outer', (suite) => {
    test.beforeAll(() => undefined);
    suite.test('must never be discovered', () => {
      throw new Error('Nested root hook body must not execute');
    });
  });
});
