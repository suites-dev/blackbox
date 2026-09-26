import { expect, it } from 'vitest';

import { managerRequest } from '../../../ipc/client.js';
import { runCapsuleManager } from '../../../manager.js';
import { readCapsuleProgress } from '../../../progress/store.js';
import { readCapsuleRecord, writeCapsuleRecord } from '../../../records.js';
import { catalogFixture, readyCollectorRuntime } from '../../testing/acquisition.fixture.js';
import { requestFixture } from '../../testing/request.fixture.js';
import { activationStartupSandbox } from '../startup.fixture.js';
import { activationPlan, installActivationFixture } from '../verification.fixture.js';
import { collectorStatusServer } from './http-status.fixture.js';
import { validActivation, validCollectorStatus } from './status-cases.fixture.js';

it.each(['runtime', 'serviceName'] as const)(
  'never starts application readiness when valid evidence is followed by blank %s', async (field) => {
    const stopped: string[] = [];
    const fixture = await requestFixture((input) => { stopped.push(input.reason); return Promise.resolve(); });
    await installActivationFixture(fixture.projectDirectory);
    await new Promise<void>((resolve) => { fixture.manager.server.close(() => { resolve(); }); });
    await writeCapsuleRecord({ projectDirectory: fixture.projectDirectory,
      record: { ...fixture.manager.record, state: 'admitted',
        manager: { kind: 'not-started' }, entrypoint: { kind: 'unavailable' },
        readiness: { kind: 'unavailable' } },
    });
    const receiver = await collectorStatusServer({ status: 200, body: JSON.stringify({
      ...validCollectorStatus(fixture), instrumentation: { kind: 'activated', activations: [
        validActivation, { ...validActivation, [field]: ' \t\n' },
      ] },
    }) });
    const sandbox = activationStartupSandbox(fixture.manager.sandbox);
    const endpoint = new URL(receiver.telemetry.endpoints.baseUrl);
    try {
      await runCapsuleManager(fixture, { collectorRuntime: readyCollectorRuntime,
        catalog: { load: () => Promise.resolve(catalogFixture(fixture.projectDirectory)),
          resolve: () => activationPlan({
            configured: true,
            projectDirectory: fixture.projectDirectory,
          }) },
        sandbox: { projectName: () => 'project', start: () => Promise.resolve({
          ...sandbox, telemetry: receiver.telemetry,
          inspectTelemetry: () => Promise.resolve(receiver.telemetry),
          endpoints: new Map([['entrypoint', { name: 'entrypoint', service: 'api',
            containerPort: 3000, host: endpoint.hostname, port: Number(endpoint.port) }]]),
        }) }, now: () => new Date(),
      });
      expect(await readCapsuleRecord(fixture)).toMatchObject({ state: 'start-failed',
        cleanup: { kind: 'complete' }, readiness: { kind: 'unavailable' },
        failure: { error: { message: expect.stringContaining('is invalid') } } });
      expect(stopped).toEqual(['failed']);
      expect(receiver.requests.length).toBeGreaterThan(0);
      expect(receiver.requests.every((url) => url === '/status')).toBe(true);
      const progress = await readCapsuleProgress(fixture);
      for (const kind of ['readiness-started', 'readiness-succeeded', 'capsule-ready']) {
        expect(progress.map((event) => event.kind)).not.toContain(kind);
      }
      expect(progress.at(-1)).toMatchObject({ kind: 'capsule-start-failed', stage: 'acquisition' });
    } finally {
      if ((await readCapsuleRecord(fixture)).state === 'running') {
        await managerRequest({ socketPath: fixture.socketPath,
          request: { kind: 'stop-request', requestId: 'cleanup-invalid-status', reason: 'failed' } });
      }
      await fixture.close();
      await receiver.close();
    }
  },
);
