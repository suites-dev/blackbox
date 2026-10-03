import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TestInfo } from '@playwright/test';
import { expect, it } from 'vitest';

import { createUnavailableBlackboxActivities } from '../effects/attempt-effects.js';
import {
  createBlackboxEffects,
  registerBlackboxEffectsClose,
} from '../effects/runtime.js';
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
    stop: () => {
      events.push('stop');
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

it('closes retained handles after fixture use and before sandbox cleanup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blackbox-attempt-close-'));
  const events: string[] = [];
  try {
    const attempt = runningAttempt(root, events);
    await runAttemptFixture({
      runtime: { start: () => Promise.resolve(attempt) },
      policy: { sandboxCleanupTimeoutMs: 1000 },
      testInfo: testInfo(root),
      catalogEntry: { kind: 'system', id: 'orders' },
      blackboxEnvironment: {},
      use: () => {
        events.push('use');
        return Promise.resolve();
      },
    });
    expect(events).toEqual(['use', 'close', 'stop']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
