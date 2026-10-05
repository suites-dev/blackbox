import { createBlackboxSystemTest } from '../../fixtures.js';
import { systemSandboxRuntime } from './runtime.fixture.js';

const test = createBlackboxSystemTest(systemSandboxRuntime);
let escapedDeclaration: (() => void) | undefined;

test.system('orders', (system) => {
  system.sandbox('outer', (suite) => {
    escapedDeclaration = () => {
      suite.test('must never be discovered', () => {
        throw new Error('Escaped declaration body must not execute');
      });
    };
  });
});

escapedDeclaration!();
