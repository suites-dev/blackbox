import { createBlackboxTest } from '../../fixtures.js';
import { systemSandboxRuntime } from './runtime.fixture.js';

const test = createBlackboxTest(systemSandboxRuntime);
const extended = test.extend<{ readonly sandboxDependent: string }>({
  sandboxDependent: async ({ sandbox }, use) => {
    await use(sandbox.executionId);
  },
});

function declareTest(target: typeof test, id: string): void {
  target.describe(id, () => {
    target.use({ blackbox: { system: { kind: 'system', id } } });
    target.describe('one legitimate attempt', () => {
      target('runs only when the suite hook is afterAll', ({ sandbox }) => {
        if (sandbox.catalogEntry.id !== id) {
          throw new Error('Unexpected sandbox selection');
        }
      });
    });
  });
}

function directBeforeAll(): void {
  test.beforeAll(({ sandbox }) => {
    void sandbox;
  });
  declareTest(test, 'direct-before-all');
}

function transitiveBeforeAll(): void {
  extended.beforeAll(({ sandboxDependent }) => {
    void sandboxDependent;
  });
  declareTest(extended, 'transitive-before-all');
}

function directAfterAll(): void {
  test.afterAll(({ sandbox }) => {
    void sandbox;
  });
  declareTest(test, 'direct-after-all');
}

function transitiveAfterAll(): void {
  extended.afterAll(({ sandboxDependent }) => {
    void sandboxDependent;
  });
  declareTest(extended, 'transitive-after-all');
}

switch (process.env.BLACKBOX_SYSTEM_SANDBOX_SCENARIO) {
  case 'direct-before-all':
    directBeforeAll();
    break;
  case 'transitive-before-all':
    transitiveBeforeAll();
    break;
  case 'direct-after-all':
    directAfterAll();
    break;
  case 'transitive-after-all':
    transitiveAfterAll();
    break;
  default:
    throw new Error('Unknown hook fixture misuse scenario');
}
