import { setTimeout as delay } from 'node:timers/promises';

import { expect as playwrightExpect } from '@playwright/test';

import { createBlackboxTest } from '../fixtures.js';
import { createUnavailableBlackboxActivities } from '../effects/attempt-effects.js';
import type { BlackboxAttemptRuntime } from '../runtime/acquisition.js';

const runtime = {
  async start(input) {
    const selection = input.selection;
    if (selection.kind === 'unselected') {
      throw new Error('test fixture did not select a catalog entry');
    }
    await delay(100);
    return {
      sandbox: {
        sandboxId: 'timeout-sandbox',
        executionId: 'timeout-execution',
        catalogEntry: {
          id: selection.id,
          kind: selection.kind,
        },
        projectName: 'timeout-project',
        artifactDirectory: input.artifactDirectory,
        entrypoint: {
          url: 'http://127.0.0.1:1',
          host: '127.0.0.1',
          port: 1,
          protocol: 'http',
        },
        containers: new Map(),
      },
      telemetry: {
        sessionId: 'timeout-session',
        executionId: 'timeout-execution',
        inspect: () => Promise.resolve({ kind: 'disabled' as const }),
        read: () => Promise.reject(new Error('not used by this fixture')),
        readTrace: () => Promise.reject(new Error('not used by this fixture')),
      },
      effects: {
        sessionId: 'timeout-session',
        executionId: 'timeout-execution',
      },
      activities: createUnavailableBlackboxActivities(),
      stop: (reason) => {
        process.stdout.write(`BLACKBOX_PLAYWRIGHT_TIMEOUT_STOP ${selection.id} ${reason}\n`);
        return Promise.resolve();
      },
    };
  },
} satisfies BlackboxAttemptRuntime;

const test = createBlackboxTest(runtime);

const veryLateRuntime = {
  async start() {
    await delay(500);
    throw new Error('very late acquisition failure');
  },
} satisfies BlackboxAttemptRuntime;

const boundedTest = createBlackboxTest(veryLateRuntime, {
  sandboxCleanupTimeoutMs: 30,
});

const verySlowStopRuntime = {
  async start(input) {
    const attempt = await runtime.start(input);
    return {
      ...attempt,
      async stop() {
        process.stdout.write('BLACKBOX_PLAYWRIGHT_SLOW_STOP_INVOKED\n');
        await delay(500);
      },
    };
  },
} satisfies BlackboxAttemptRuntime;

const boundedStopTest = createBlackboxTest(verySlowStopRuntime, {
  sandboxCleanupTimeoutMs: 30,
});

const fastRuntime = {
  start(input) {
    if (input.selection.kind === 'unselected') {
      return Promise.reject(new Error('test fixture did not select a catalog entry'));
    }
    return Promise.resolve({
      sandbox: {
        sandboxId: 'body-timeout-sandbox',
        executionId: 'body-timeout-execution',
        catalogEntry: input.selection,
        projectName: 'body-timeout-project',
        artifactDirectory: input.artifactDirectory,
        entrypoint: {
          url: 'http://127.0.0.1:1',
          host: '127.0.0.1',
          port: 1,
          protocol: 'http' as const,
        },
        containers: new Map(),
      },
      telemetry: {
        sessionId: 'body-timeout-session',
        executionId: 'body-timeout-execution',
        inspect: () => Promise.resolve({ kind: 'disabled' as const }),
        read: () => Promise.reject(new Error('not used by this fixture')),
        readTrace: () => Promise.reject(new Error('not used by this fixture')),
      },
      effects: {
        sessionId: 'body-timeout-session',
        executionId: 'body-timeout-execution',
      },
      activities: createUnavailableBlackboxActivities(),
      stop: (reason) => {
        process.stdout.write(`BLACKBOX_PLAYWRIGHT_BODY_TIMEOUT_STOP ${reason}\n`);
        return Promise.resolve();
      },
    });
  },
} satisfies BlackboxAttemptRuntime;

const bodyTimeoutTest = createBlackboxTest(fastRuntime, {
  sandboxCleanupTimeoutMs: 30,
});

test.describe('fixture acquisition timeout', () => {
  test.use({ catalogEntry: { kind: 'system', id: 'orders' } });
  test.setTimeout(20);

  test('times out before a slow acquisition reaches the test body', () => {
    process.stdout.write('BLACKBOX_PLAYWRIGHT_ACQUISITION_BODY_ENTERED\n');
  });
});

boundedTest.describe('bounded fixture acquisition cleanup', () => {
  boundedTest.use({ catalogEntry: { kind: 'system', id: 'orders' } });
  boundedTest.setTimeout(20);

  boundedTest('reports when late acquisition cleanup does not settle', () => {
    process.stdout.write('BLACKBOX_PLAYWRIGHT_LATE_BODY_ENTERED\n');
  });
});

boundedStopTest.describe('bounded fixture teardown', () => {
  boundedStopTest.use({ catalogEntry: { kind: 'system', id: 'orders' } });
  boundedStopTest.setTimeout(500);

  boundedStopTest('reports when sandbox teardown does not settle', () => {
    playwrightExpect(true).toBe(true);
  });
});

bodyTimeoutTest.describe('timed out test body cleanup', () => {
  bodyTimeoutTest.use({ catalogEntry: { kind: 'system', id: 'body-timeout' } });
  bodyTimeoutTest.setTimeout(50);

  bodyTimeoutTest('completes its native cleanup step after the body times out', async () => {
    process.stdout.write('BLACKBOX_PLAYWRIGHT_BODY_ENTERED\n');
    await delay(200);
  });
});
