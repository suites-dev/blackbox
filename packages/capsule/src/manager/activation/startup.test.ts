import { afterEach, expect, it, vi } from 'vitest';

import { runCapsuleManager } from '../../manager.js';
import { readCapsuleProgress } from '../../progress/store.js';
import { readCapsuleRecord } from '../../records.js';
import { catalogFixture, readyCollectorRuntime } from '../testing/acquisition.fixture.js';
import { requestFixture } from '../testing/request.fixture.js';
import { activationStartupSandbox } from './startup.fixture.js';
import { activationPlan } from './verification.fixture.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('records startup failure before application readiness when activation is missing', async () => {
  const stopped: string[] = [];
  const fixture = await requestFixture((input) => {
    stopped.push(input.reason);
    return Promise.resolve();
  });
  await new Promise<void>((resolve) =>
    fixture.manager.server.close(() => {
      resolve();
    }),
  );
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string | URL | Request) => {
      urls.push(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url);
      return Promise.resolve(
        Response.json({
          kind: 'collector-status',
          sessionId: fixture.sessionId,
          executionId: fixture.executionId,
          instrumentation: { kind: 'not-activated' },
        }),
      );
    }),
  );
  try {
    await runCapsuleManager(fixture, {
      collectorRuntime: readyCollectorRuntime,
      catalog: {
        load: () => Promise.resolve(catalogFixture(fixture.projectDirectory)),
        resolve: () => activationPlan(true),
      },
      sandbox: {
        projectName: () => 'project',
        start: () => Promise.resolve(activationStartupSandbox(fixture.manager.sandbox)),
      },
      now: () => new Date(),
    });
    expect(await readCapsuleRecord(fixture)).toMatchObject({
      state: 'start-failed',
      cleanup: { kind: 'complete' },
      failure: { error: { message: expect.stringContaining('api (node)') } },
    });
    expect(stopped).toEqual(['failed']);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => url === 'http://collector.test/status')).toBe(true);
    expect((await readCapsuleProgress(fixture)).at(-1)).toMatchObject({
      kind: 'capsule-start-failed',
      stage: 'acquisition',
    });
  } finally {
    await fixture.close();
  }
});
