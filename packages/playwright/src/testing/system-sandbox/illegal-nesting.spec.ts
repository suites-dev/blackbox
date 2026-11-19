import { createBlackboxTest } from '../../fixtures.js';
import { systemSandboxRuntime } from './runtime.fixture.js';

const test = createBlackboxTest(systemSandboxRuntime);
const scenario = process.env.BLACKBOX_SYSTEM_SANDBOX_SCENARIO;
if (scenario === 'invalid-selection') {
  // @ts-expect-error Runtime validation protects JavaScript consumers too.
  test.use({ blackbox: { system: { kind: 'service', id: 'orders' } } });
} else if (scenario === 'invalid-environment') {
  // @ts-expect-error Environment values must also be validated at runtime.
  test.use({ blackbox: { system: 'orders', environment: { PORT: 3000 } } });
} else if (scenario !== 'unselected-fixture') {
  throw new Error('Unknown option validation scenario');
}

test('invalid options cannot enter the body', ({ sandbox }) => {
  void sandbox;
  throw new Error('Invalid option body must not execute');
});
