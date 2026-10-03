import { createBlackboxSystemTest } from '../../fixtures.js';
import { systemSandboxRuntime } from './runtime.fixture.js';

const test = createBlackboxSystemTest(systemSandboxRuntime);

// @ts-expect-error Public types reject this call; the runtime guard protects JavaScript users.
test('flat root test must be rejected', () => {
  throw new Error('Flat root body must not execute');
});
