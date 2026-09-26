import { expect, it, vi } from 'vitest';

import { managerRequest } from '../../../ipc/client.js';
import { runCapsuleManager } from '../../../manager.js';
import { readCapsuleProgress } from '../../../progress/store.js';
import { readCapsuleRecord, writeCapsuleRecord } from '../../../records.js';
import { catalogFixture, readyCollectorRuntime } from '../../testing/acquisition.fixture.js';
import { requestFixture } from '../../testing/request.fixture.js';
import { activationStartupSandbox } from '../startup.fixture.js';
import {
  activationPlan,
  activationRuntimeAdapters,
  installActivationFixture,
} from '../verification.fixture.js';
import { validActivation, validCollectorStatus } from './status-cases.fixture.js';

async function runManagerWithActivation(input: {
  readonly fixture: Awaited<ReturnType<typeof requestFixture>>;
  readonly sandbox: ReturnType<typeof activationStartupSandbox>;
}): Promise<void> {
  await runCapsuleManager(
    {
      ...input.fixture,
      runtimeActivationAdapters: activationRuntimeAdapters,
    },
    {
      collectorRuntime: readyCollectorRuntime,
      catalog: {
        load: () => Promise.resolve(catalogFixture(input.fixture.projectDirectory)),
        resolve: () =>
          activationPlan({
            configured: true,
            projectDirectory: input.fixture.projectDirectory,
          }),
      },
      sandbox: {
        projectName: () => 'project',
        start: () => Promise.resolve(input.sandbox),
      },
      now: () => new Date(),
    },
  );
}

it.each(['runtime', 'serviceName'] as const)(
  'never starts application readiness when valid evidence is followed by blank %s',
  async (field) => {
    const stopped: string[] = [];
    const fixture = await requestFixture((input) => {
      stopped.push(input.reason);
      return Promise.resolve();
    });
    await installActivationFixture(fixture.projectDirectory);
    await new Promise<void>((resolve) => {
      fixture.manager.server.close(() => {
        resolve();
      });
    });
    await writeCapsuleRecord({
      projectDirectory: fixture.projectDirectory,
      record: {
        ...fixture.manager.record,
        state: 'admitted',
        manager: { kind: 'not-started' },
        entrypoint: { kind: 'unavailable' },
        readiness: { kind: 'unavailable' },
      },
    });
    const requests: string[] = [];
    const body = JSON.stringify({
      ...validCollectorStatus(fixture),
      instrumentation: {
        kind: 'activated',
        activations: [validActivation, { ...validActivation, [field]: ' \t\n' }],
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>((request) => {
        requests.push(request instanceof Request ? request.url : request.toString());
        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }),
    );
    const sandbox = activationStartupSandbox(fixture.manager.sandbox);
    try {
      await runManagerWithActivation({ fixture, sandbox });
      expect(await readCapsuleRecord(fixture)).toMatchObject({
        state: 'start-failed',
        cleanup: { kind: 'complete' },
        readiness: { kind: 'unavailable' },
        failure: { error: { message: expect.stringContaining('is invalid') } },
      });
      expect(stopped).toEqual(['failed']);
      expect(requests.length).toBeGreaterThan(0);
      expect(requests.every((url) => url === 'http://collector.test/status')).toBe(true);
      const progress = await readCapsuleProgress(fixture);
      for (const kind of ['readiness-started', 'readiness-succeeded', 'capsule-ready']) {
        expect(progress.map((event) => event.kind)).not.toContain(kind);
      }
      expect(progress.at(-1)).toMatchObject({ kind: 'capsule-start-failed', stage: 'acquisition' });
    } finally {
      if ((await readCapsuleRecord(fixture)).state === 'running') {
        await managerRequest({
          socketPath: fixture.socketPath,
          request: { kind: 'stop-request', requestId: 'cleanup-invalid-status', reason: 'failed' },
        });
      }
      await fixture.close();
      vi.unstubAllGlobals();
    }
  },
);
