import { createServer, type Server } from 'node:http';

import { expect as playwrightExpect } from '@playwright/test';

import { createBlackboxSystemTest } from '../../fixtures.js';
import { test as publicTest } from '../../index.js';
import type { BlackboxAttemptRuntime } from '../../runtime/acquisition.js';
import { record, startRespondingAttempt } from './runtime.fixture.js';

interface AuditFixtures {
  readonly auditAttempt: string;
}

let workerJoinedParallelBarrier = false;
const rendezvousRuntime = {
  async start(input) {
    const attempt = await startRespondingAttempt(input);
    if (workerJoinedParallelBarrier) {
      return attempt;
    }
    try {
      const url = process.env.BLACKBOX_PARALLEL_BARRIER_URL;
      if (url === undefined) {
        throw new Error('Parallel rendezvous URL was not configured');
      }
      const response = await fetch(`${url}/arrive`);
      if (response.status !== 204) {
        throw new Error(`Parallel rendezvous failed with HTTP ${response.status}`);
      }
      workerJoinedParallelBarrier = true;
      return attempt;
    } catch (error) {
      await attempt.stop('failed');
      throw error;
    }
  },
} satisfies BlackboxAttemptRuntime;

const test = createBlackboxSystemTest(rendezvousRuntime);
const extendedTest = test.extend<AuditFixtures>({
  auditAttempt: [
    async ({ sandbox }, use) => {
      record({ kind: 'auto-fixture-setup', executionId: sandbox.executionId });
      await use(sandbox.executionId);
      record({ kind: 'auto-fixture-teardown', executionId: sandbox.executionId });
    },
    { auto: true },
  ],
});

let controlServer: Server | undefined;
let controlUrl: string | undefined;

test.beforeAll(async ({ request }) => {
  controlServer = createServer((_incoming, response) => {
    response.end('control-ok');
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    controlServer!.once('error', rejectListen);
    controlServer!.listen(0, '127.0.0.1', () => {
      controlServer!.off('error', rejectListen);
      resolveListen();
    });
  });
  const address = controlServer.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Control server did not expose a TCP address');
  }
  controlUrl = `http://127.0.0.1:${address.port}`;
  const response = await request.get(`${controlUrl}/before-all`);
  playwrightExpect(await response.text()).toBe('control-ok');
  record({ kind: 'native-hook-request', phase: 'beforeAll' });
});

test.afterAll(async ({ request }) => {
  if (controlServer === undefined || controlUrl === undefined) {
    throw new Error('Control server was not initialized');
  }
  const response = await request.get(`${controlUrl}/after-all`);
  playwrightExpect(await response.text()).toBe('control-ok');
  record({ kind: 'native-hook-request', phase: 'afterAll' });
  await new Promise<void>((resolveClose, rejectClose) => {
    controlServer!.close((error) => {
      if (error === undefined) {
        resolveClose();
      } else {
        rejectClose(error);
      }
    });
  });
});

test.system('orders', (system) => {
  system.sandbox('blue', { environment: { REGION: 'eu', TENANT: 'blue' } }, (suite) => {
    suite.beforeEach(({ sandbox }, testInfo) => {
      record({
        kind: 'beforeEach',
        executionId: sandbox.executionId,
        title: testInfo.title,
        retry: testInfo.retry,
      });
    });

    suite.afterEach(({ sandbox }, testInfo) => {
      record({
        kind: 'afterEach',
        executionId: sandbox.executionId,
        title: testInfo.title,
        retry: testInfo.retry,
      });
    });

    suite.describe('nested checkout flow', () => {
      suite.test('fixtureless acquisition keeps native steps', async () => {
        await test.step('outer user step', async () => {
          await test.step('nested user step', () => {
            playwrightExpect(true).toBe(true);
          });
        });
      });

      suite.test('hooks body and native request share one attempt', async (
        { request, sandbox },
        testInfo,
      ) => {
        playwrightExpect(testInfo.project.use.baseURL).toBe(
          'http://127.0.0.1:1/static-native-base/',
        );
        const response = await request.get(`${sandbox.entrypoint.url}/orders?source=native`);
        playwrightExpect(response.ok()).toBe(true);
        playwrightExpect(await response.json()).toEqual({
          executionId: sandbox.executionId,
          method: 'GET',
          path: '/orders?source=native',
        });
        record({
          kind: 'body',
          executionId: sandbox.executionId,
          title: testInfo.title,
          retry: testInfo.retry,
          workerIndex: testInfo.workerIndex,
          parallelIndex: testInfo.parallelIndex,
        });
      });

      suite.test('retry receives a fresh attempt', ({ sandbox }, testInfo) => {
        record({
          kind: 'retry-body',
          executionId: sandbox.executionId,
          retry: testInfo.retry,
          workerIndex: testInfo.workerIndex,
          parallelIndex: testInfo.parallelIndex,
        });
        playwrightExpect(testInfo.retry).toBe(1);
      });
    });
  });

  system.sandbox('green', { environment: { REGION: 'us', TENANT: 'green' } }, (suite) => {
    suite.test('second sandbox group has isolated options', ({ sandbox }, testInfo) => {
      record({
        kind: 'body',
        executionId: sandbox.executionId,
        title: testInfo.title,
        retry: testInfo.retry,
        workerIndex: testInfo.workerIndex,
        parallelIndex: testInfo.parallelIndex,
      });
      playwrightExpect(sandbox.catalogEntry).toEqual({ kind: 'system', id: 'orders' });
    });
  });
});

test.system({ kind: 'system', id: 'billing' }, (system) => {
  system.sandbox('default options', (suite) => {
    suite.test('object system selection is preserved', ({ sandbox }, testInfo) => {
      record({
        kind: 'body',
        executionId: sandbox.executionId,
        title: testInfo.title,
        retry: testInfo.retry,
        workerIndex: testInfo.workerIndex,
        parallelIndex: testInfo.parallelIndex,
      });
      playwrightExpect(sandbox.catalogEntry).toEqual({ kind: 'system', id: 'billing' });
    });
  });

  system.sandbox(
    'fixtureless group',
    { environment: { PROBE: 'fixtureless' } },
    (suite) => {
      suite.test('acquires without any Blackbox fixture dependency', () => {
        playwrightExpect(true).toBe(true);
      });
      suite.test.skip('native skip modifier remains available', () => {
        throw new Error('Skipped body must not execute');
      });
      suite.test.fixme('native fixme modifier remains available', () => {
        throw new Error('Fixme body must not execute');
      });
    },
  );
});

test.system({ kind: 'subsystem', id: 'invoice-worker' }, (system) => {
  system.sandbox('subsystem group', { environment: { MODE: 'worker' } }, (suite) => {
    suite.test('subsystem selection is preserved', ({ sandbox }, testInfo) => {
      record({
        kind: 'body',
        executionId: sandbox.executionId,
        title: testInfo.title,
        retry: testInfo.retry,
        workerIndex: testInfo.workerIndex,
        parallelIndex: testInfo.parallelIndex,
      });
      playwrightExpect(sandbox.catalogEntry).toEqual({
        kind: 'subsystem',
        id: 'invoice-worker',
      });
    });
  });
});

extendedTest.system('extended', (system) => {
  system.sandbox('custom automatic fixture', (suite) => {
    suite.test('automatic fixture dependency shares the group attempt', ({
      auditAttempt,
      sandbox,
    }) => {
      playwrightExpect(auditAttempt).toBe(sandbox.executionId);
    });
  });
});

/** Compile-only contract checks. This helper is exported and intentionally never invoked. */
export function verifyPublicSystemTestTypes(): void {
  // @ts-expect-error Flat root tests bypass the required system and sandbox declarations.
  publicTest('flat root test is unavailable', () => {
    throw new Error('Compile-only flat body');
  });
  publicTest.system('type-example', (system) => {
    system.sandbox('type-example', { environment: { MODE: 'typed' } }, (suite) => {
      suite.test('public type example', ({ sandbox }) => {
        void sandbox.entrypoint.url;
      });
      // @ts-expect-error Sandbox groups intentionally expose per-attempt hooks only.
      suite.beforeAll(() => undefined);
    });
  });
  // @ts-expect-error Attempt-scoped Blackbox fixtures are excluded from root suite hooks.
  publicTest.beforeAll(({ sandbox }) => {
    void sandbox;
  });
}
