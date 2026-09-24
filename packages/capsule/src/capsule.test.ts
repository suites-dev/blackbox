import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { capsuleConnectionEnvironment } from './connection-environment.js';
import {
  admitCapsuleRecord,
  capsuleRecordPath,
  readCapsuleActivities,
  readCapsuleRecord,
  type CapsuleSessionRecord,
} from './records.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('Capsule durable admission', () => {
  it('atomically admits one exact session and preserves its unfinished state', async () => {
    const projectDirectory = await mkdtemp(join(tmpdir(), 'blackbox-capsule-'));
    temporaryDirectories.push(projectDirectory);
    const record = {
      schemaVersion: 1,
      sessionId: 'capsule-00000000-0000-4000-8000-000000000001',
      executionId: '00000000-0000-4000-8000-000000000001',
      system: 'orders',
      title: 'Orders experiment',
      description: { kind: 'omitted' },
      state: 'admitted',
      revision: 0,
      admittedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      manager: { kind: 'not-started' },
      socketPath: join(projectDirectory, 'manager.sock'),
      entrypoint: { kind: 'unavailable' },
      containers: [],
      cleanup: { kind: 'not-attempted' },
      failure: { kind: 'none' },
      composeProject: { kind: 'unavailable' },
      artifactRoot: join(
        projectDirectory,
        '.blackbox',
        'experiments',
        'capsule-capsule-00000000-0000-4000-8000-000000000001',
      ),
      networks: [],
      volumes: [],
      readiness: { kind: 'unavailable' },
    } satisfies CapsuleSessionRecord;

    await admitCapsuleRecord({ projectDirectory, record });

    await expect(
      readCapsuleRecord({ projectDirectory, sessionId: record.sessionId }),
    ).resolves.toEqual(record);
    await expect(admitCapsuleRecord({ projectDirectory, record })).rejects.toMatchObject({
      code: 'EEXIST',
    });
    await expect(
      readCapsuleActivities({ projectDirectory, sessionId: record.sessionId }),
    ).resolves.toEqual([]);
    expect(
      JSON.parse(
        await readFile(
          capsuleRecordPath({ projectDirectory, sessionId: record.sessionId }),
          'utf8',
        ),
      ),
    ).toEqual(record);
  });
});

describe('Capsule connection contract', () => {
  it('provides explicit connection environment without changing the application wire', () => {
    expect(
      capsuleConnectionEnvironment({
        sessionId: 'capsule-id',
        entrypoint: {
          url: 'http://127.0.0.1:45123',
          host: '127.0.0.1',
          port: 45_123,
          protocol: 'http',
        },
      }),
    ).toEqual({
      BLACKBOX_CAPSULE_SESSION_ID: 'capsule-id',
      BLACKBOX_CAPSULE_ENTRYPOINT_URL: 'http://127.0.0.1:45123',
      BLACKBOX_CAPSULE_ENTRYPOINT_HOST: '127.0.0.1',
      BLACKBOX_CAPSULE_ENTRYPOINT_PORT: '45123',
    });
  });
});
