import { createBlackboxSystemTest } from '../../fixtures.js';
import { systemSandboxRuntime } from './runtime.fixture.js';

const test = createBlackboxSystemTest(systemSandboxRuntime);

test.system('orders', (system) => {
  system.sandbox('outer', (suite) => {
    const unsupported = suite as typeof suite & { beforeAll(callback: () => void): void };
    unsupported.beforeAll(() => undefined);
  });
});
