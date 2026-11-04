import { createServer, type Server } from 'node:http';

import { expect as playwrightExpect } from '@playwright/test';

import { createBlackboxTest } from '../../fixtures.js';
import type { BlackboxAttemptRuntime } from '../../runtime/acquisition.js';
import { joinParallelBarrier } from '../system-sandbox-harness/barrier-client.fixture.js';
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
      await joinParallelBarrier();
      workerJoinedParallelBarrier = true;
      return attempt;
    } catch (error) {
      await attempt.stop('failed');
      throw error;
    }
  },
} satisfies BlackboxAttemptRuntime;

const test = createBlackboxTest(rendezvousRuntime);
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

function declareBlue(): void {
  test.use({
    blackbox: {
      system: { kind: 'system', id: 'orders' },
      environment: { REGION: 'eu', TENANT: 'blue' },
    },
  });
  test.beforeEach(({ sandbox }, testInfo) => {
    record({
      kind: 'beforeEach',
      executionId: sandbox.executionId,
      title: testInfo.title,
      retry: testInfo.retry,
    });
  });

  test.afterEach(({ sandbox }, testInfo) => {
    record({
      kind: 'afterEach',
      executionId: sandbox.executionId,
      title: testInfo.title,
      retry: testInfo.retry,
    });
  });

  test.describe('nested checkout flow', () => {
    test('fixtureless acquisition keeps native steps', async () => {
      await test.step('outer user step', async () => {
        await test.step('nested user step', () => {
          playwrightExpect(true).toBe(true);
        });
      });
    });

    test('hooks body and native request share one attempt', async ({
      request,
      sandbox,
    }, testInfo) => {
      playwrightExpect(testInfo.project.use.baseURL).toBe('http://127.0.0.1:1/static-native-base/');
      const response = await request.get('/orders?source=native');
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

    test('retry receives a fresh attempt', ({ sandbox }, testInfo) => {
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
}

test.describe('orders', () => {
  test.use({ blackbox: { system: { kind: 'system', id: 'orders' } } });
  test.describe('blue', declareBlue);

  test.describe('green', () => {
    test.use({
      blackbox: {
        system: { kind: 'system', id: 'orders' },
        environment: { REGION: 'us', TENANT: 'green' },
      },
    });
    test('second sandbox group has isolated options', ({ sandbox }, testInfo) => {
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

test.describe('billing', () => {
  test.use({ blackbox: { system: { kind: 'system', id: 'billing' } } });
  test.describe('default options', () => {
    test('object system selection is preserved', ({ sandbox }, testInfo) => {
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

  test.describe('fixtureless group', () => {
    test.use({
      blackbox: {
        system: { kind: 'system', id: 'billing' },
        environment: { PROBE: 'fixtureless' },
      },
    });
    test('acquires without any Blackbox fixture dependency', () => {
      playwrightExpect(true).toBe(true);
    });
    test.skip('native skip modifier remains available', () => {
      throw new Error('Skipped body must not execute');
    });
    test.fixme('native fixme modifier remains available', () => {
      throw new Error('Fixme body must not execute');
    });
  });
});

test.describe('invoice-worker', () => {
  test.use({ blackbox: { system: { kind: 'subsystem', id: 'invoice-worker' } } });
  test.describe('subsystem group', () => {
    test.use({
      blackbox: {
        system: { kind: 'subsystem', id: 'invoice-worker' },
        environment: { MODE: 'worker' },
      },
    });
    test('subsystem selection is preserved', ({ sandbox }, testInfo) => {
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

extendedTest.describe('extended', () => {
  extendedTest.use({ blackbox: { system: { kind: 'system', id: 'extended' } } });
  extendedTest.describe('custom automatic fixture', () => {
    extendedTest(
      'automatic fixture dependency shares the group attempt',
      ({ auditAttempt, sandbox }) => {
        playwrightExpect(auditAttempt).toBe(sandbox.executionId);
      },
    );
  });
});
