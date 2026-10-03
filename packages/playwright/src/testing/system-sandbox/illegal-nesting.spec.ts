import { createBlackboxSystemTest } from '../../fixtures.js';
import type {
  BlackboxNativeTestArgs,
  BlackboxNativeWorkerArgs,
  BlackboxSandboxSuite,
  BlackboxSystemScope,
} from '../../types.js';
import { systemSandboxRuntime } from './runtime.fixture.js';

const test = createBlackboxSystemTest(systemSandboxRuntime);
type SystemScope = BlackboxSystemScope<BlackboxNativeTestArgs, BlackboxNativeWorkerArgs>;
type SandboxSuite = BlackboxSandboxSuite<BlackboxNativeTestArgs, BlackboxNativeWorkerArgs>;

function declareLeaf(system: SystemScope, title: string): void {
  system.sandbox('guard bypass probe', (suite) => {
    suite.test(title, ({ sandbox }) => {
      void sandbox.executionId;
    });
  });
}

function nestedSandbox(): void {
  test.system('orders', (system) => {
    system.sandbox('outer', () => {
      system.sandbox('nested', (suite) => {
        suite.test('must never be discovered', () => {
          throw new Error('Nested sandbox body must not execute');
        });
      });
    });
  });
}

function asyncSystem(): void {
  // The public callback result is intentionally broad; runtime validation rejects promises.
  test.system('orders', async (system) => {
    declareLeaf(system, 'async system guard bypass probe');
    await Promise.resolve();
  });
}

function asyncSandbox(): void {
  test.system('orders', (system) => {
    // The public callback result is intentionally broad; runtime validation rejects promises.
    system.sandbox('async', async (suite) => {
      suite.test('async sandbox guard bypass probe', ({ sandbox }) => {
        void sandbox.executionId;
      });
      await Promise.resolve();
    });
  });
}

function escapedSystem(): void {
  let escaped: (() => void) | undefined;
  test.system('orders', (system) => {
    escaped = () => {
      system.sandbox('escaped', (suite) => {
        suite.test('must never be discovered', () => {
          throw new Error('Escaped system body must not execute');
        });
      });
    };
  });
  escaped!();
}

function invalidSelection(): void {
  Reflect.apply(test.system.bind(test), undefined, [
    { kind: 'service', id: 'orders' },
    (system: SystemScope) => {
      declareLeaf(system, 'invalid selection guard bypass probe');
    },
  ]);
}

function invalidEnvironment(): void {
  test.system('orders', (system) => {
    Reflect.apply(system.sandbox.bind(system), undefined, [
      'invalid environment',
      { environment: { PORT: 3000 } },
      (suite: SandboxSuite) => {
        suite.test('invalid environment guard bypass probe', ({ sandbox }) => {
          void sandbox.executionId;
        });
      },
    ]);
  });
}

switch (process.env.BLACKBOX_SYSTEM_SANDBOX_SCENARIO) {
  case 'nested-sandbox':
    nestedSandbox();
    break;
  case 'async-system':
    asyncSystem();
    break;
  case 'async-sandbox':
    asyncSandbox();
    break;
  case 'escaped-system':
    escapedSystem();
    break;
  case 'invalid-selection':
    invalidSelection();
    break;
  case 'invalid-environment':
    invalidEnvironment();
    break;
  default:
    throw new Error('Unknown declaration validation scenario');
}
