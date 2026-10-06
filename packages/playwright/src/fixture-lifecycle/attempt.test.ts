import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TestInfo } from '@playwright/test';
import { expect, it } from 'vitest';

import { createUnavailableBlackboxActivities } from '../effects/attempt-effects.js';
import { createBlackboxEffects, registerBlackboxEffectsClose } from '../effects/runtime.js';
import type { RunningBlackboxAttempt } from '../runtime/acquisition.js';
import { runAttemptFixture } from './attempt.js';

function runningAttempt(root: string, events: string[]): RunningBlackboxAttempt {
  const effects = createBlackboxEffects({
    sessionId: 'session-1',
    executionId: 'execution-1',
    evaluator: { evaluate: () => Promise.resolve({ kind: 'satisfied' }) },
  });
  registerBlackboxEffectsClose(effects, () => events.push('close'));
  return {
    sandbox: {
      sandboxId: 'sandbox-1',
      executionId: 'execution-1',
      catalogEntry: { kind: 'system', id: 'orders' },
      projectName: 'orders',
      artifactDirectory: root,
      entrypoint: {
        url: 'http://127.0.0.1:3000',
        host: '127.0.0.1',
        port: 3000,
        protocol: 'http',
      },
      containers: new Map(),
    },
    telemetry: {
      sessionId: 'session-1',
      executionId: 'execution-1',
      inspect: () => Promise.resolve({ kind: 'disabled' }),
      read: () => Promise.reject(new Error('not used')),
      readTrace: () => Promise.reject(new Error('not used')),
    },
    effects,
    activities: createUnavailableBlackboxActivities(),
    stop: (reason) => {
      events.push(`stop: ${reason}`);
      return Promise.resolve();
    },
  };
}

function testInfo(root: string): TestInfo {
  const stub = {
    timeout: 0,
    status: 'passed',
    testId: 'fixture-close-order',
    retry: 0,
    workerIndex: 0,
    parallelIndex: 0,
    config: {
      configFile: '/project/playwright.config.ts',
      metadata: { blackboxConfigFile: '/project/blackbox.config.yaml' },
      reporter: [],
    },
    outputPath: (...segments: string[]) => join(root, ...segments),
    attach: () => Promise.resolve(),
  };
  const boundary: unknown = stub;
  return boundary as TestInfo;
}

async function step<Value>(
  events: string[],
  title: string,
  operation: () => Promise<Value>,
): Promise<Value> {
  events.push(`step begin: ${title}`);
  try {
    const value = await operation();
    events.push(`step end: ${title}`);
    return value;
  } catch (error) {
    events.push(`step failed: ${title}`);
    throw error;
  }
}

it('closes retained handles after fixture use and before sandbox cleanup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blackbox-attempt-close-'));
  const events: string[] = [];
  try {
    const attempt = runningAttempt(root, events);
    await runAttemptFixture({
      runtime: {
        start: () => {
          events.push('start');
          return Promise.resolve(attempt);
        },
      },
      policy: { sandboxCleanupTimeoutMs: 1000 },
      testInfo: testInfo(root),
      catalogEntry: { kind: 'system', id: 'orders' },
      blackboxEnvironment: {},
      step: (title, operation) => step(events, title, operation),
      use: () => {
        events.push('use');
        return Promise.resolve();
      },
    });
    expect(events).toEqual([
      'step begin: Start sandbox',
      'start',
      'step end: Start sandbox',
      'use',
      'close',
      'step begin: Clean up sandbox',
      'stop: completed',
      'step end: Clean up sandbox',
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('cleans an acquired attempt as failed when start-step reporting fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blackbox-attempt-start-report-'));
  const events: string[] = [];
  try {
    const attempt = runningAttempt(root, events);
    const info = testInfo(root);
    Object.defineProperty(info, 'attach', {
      value: () => Promise.reject(new Error('synthetic attachment failure')),
    });
    await expect(
      runAttemptFixture({
        runtime: {
          start: () => {
            events.push('start');
            return Promise.resolve(attempt);
          },
        },
        policy: { sandboxCleanupTimeoutMs: 1000 },
        testInfo: info,
        catalogEntry: { kind: 'system', id: 'orders' },
        blackboxEnvironment: {},
        step: (title, operation) => step(events, title, operation),
        use: () => {
          events.push('BODY_MUST_NOT_EXECUTE');
          return Promise.resolve();
        },
      }),
    ).rejects.toThrow('Blackbox progress attachment failed');
    expect(events).toEqual([
      'step begin: Start sandbox',
      'start',
      'step failed: Start sandbox',
      'close',
      'step begin: Clean up sandbox',
      'stop: failed',
      'step end: Clean up sandbox',
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
