import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCapsuleManager } from '../../manager.js';
import { readCapsuleProgress } from '../../progress/store.js';
import {
  admitCapsuleRecord,
  capsuleSessionDirectory,
  capsuleSocketPath,
  readCapsuleRecord,
  type CapsuleSessionRecord,
} from '../../records.js';

function managerRecord(projectDirectory: string, sessionId: string): CapsuleSessionRecord {
  const admittedAt = new Date().toISOString();
  return {
    schemaVersion: 1,
    sessionId,
    executionId: '00000000-0000-4000-8000-000000000001',
    system: 'orders',
    title: 'Orders experiment',
    description: { kind: 'omitted' },
    state: 'manager-starting',
    revision: 1,
    admittedAt,
    updatedAt: admittedAt,
    manager: { kind: 'not-started' },
    socketPath: capsuleSocketPath({ projectDirectory, sessionId }),
    entrypoint: { kind: 'unavailable' },
    containers: [],
    cleanup: { kind: 'not-attempted' },
    failure: { kind: 'none' },
    composeProject: { kind: 'unavailable' },
    artifactRoot: capsuleSessionDirectory({ projectDirectory, sessionId }),
    networks: [],
    volumes: [],
    readiness: { kind: 'unavailable' },
  };
}

describe('Capsule manager startup failure', () => {
  it('persists and emits a catalog-load failure through injected ports', async () => {
    const projectDirectory = await mkdtemp(join(tmpdir(), 'capsule-manager-'));
    const sessionId = 'steady-harbor-alex';
    const bootstrap = {
      projectDirectory,
      sessionId,
      executionId: '00000000-0000-4000-8000-000000000001',
      systemId: 'orders',
      environment: {},
    };
    const record = managerRecord(projectDirectory, sessionId);
    try {
      expect(record.socketPath).toContain(
        `${join('.blackbox', 'tmp')}${process.platform === 'win32' ? '\\' : '/'}`,
      );
      expect(record.socketPath).not.toContain(
        `${join('.blackbox', 's')}${process.platform === 'win32' ? '\\' : '/'}`,
      );
      await admitCapsuleRecord({ projectDirectory, record });
      await runCapsuleManager(bootstrap, {
        catalog: {
          load: () => Promise.reject(new Error('catalog unavailable')),
          resolve: () => {
            throw new Error('unreachable');
          },
        },
        sandbox: {
          projectName: () => 'unused',
          start: () => Promise.reject(new Error('unreachable')),
        },
        now: () => new Date(),
      });
      await expect(readCapsuleRecord({ projectDirectory, sessionId })).resolves.toMatchObject({
        state: 'manager-failed',
        failure: { kind: 'recorded', error: { message: 'catalog unavailable' } },
      });
      await expect(readCapsuleProgress({ projectDirectory, sessionId })).resolves.toMatchObject([
        { kind: 'catalog-selected' },
        {
          kind: 'capsule-start-failed',
          stage: 'catalog-load',
          cause: { message: 'catalog unavailable' },
        },
      ]);
    } finally {
      await rm(projectDirectory, { recursive: true, force: true });
    }
  });
});
