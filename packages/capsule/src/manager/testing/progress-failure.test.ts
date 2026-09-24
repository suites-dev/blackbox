import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolveCatalogEntry } from '@suites/blackbox-catalog-internal';
import { expect, it } from 'vitest';
import { runCapsuleManager } from '../../manager.js';
import { capsuleProgressPath, readCapsuleProgress } from '../../progress/store.js';
import { readCapsuleRecord } from '../../records.js';
import { catalogFixture } from './acquisition.fixture.js';
import { requestFixture } from './request.fixture.js';

it('stops an acquired sandbox when progress persistence fails before manager readiness', async () => {
  let restore = () => Promise.resolve();
  const stopped: string[] = [];
  const fixture = await requestFixture(async ({ reason }) => {
    stopped.push(reason);
    await restore();
  });
  await new Promise<void>((resolve) =>
    fixture.manager.server.close(() => {
      resolve();
    }),
  );
  try {
    await runCapsuleManager(fixture, {
      catalog: {
        load: () => Promise.resolve(catalogFixture(fixture.projectDirectory)),
        resolve: ({ catalog, systemId }) =>
          resolveCatalogEntry({
            catalog,
            selection: { kind: 'explicit-entry', entryId: systemId },
          }),
      },
      sandbox: {
        projectName: () => 'test-compose',
        start: async (input) => {
          const path = capsuleProgressPath(fixture);
          const bytes = await readFile(path, 'utf8');
          restore = async () => {
            await rm(path, { recursive: true });
            await writeFile(path, bytes);
          };
          await rm(path);
          await mkdir(path);
          if (input.progress.kind !== 'events') {
            throw new Error('Expected progress sink');
          }
          input.progress.sink.emit({
            kind: 'acquisition-observation',
            sandboxId: fixture.executionId,
            projectName: 'test-compose',
            at: 'now',
            observation: { kind: 'waiting', elapsedMs: 0 },
          });
          await new Promise((resolve) => setTimeout(resolve, 20));
          return fixture.manager.sandbox;
        },
      },
      now: () => new Date(),
    });
    expect(stopped).toEqual(['failed']);
    expect(await readCapsuleRecord(fixture)).toMatchObject({
      state: 'start-failed',
      cleanup: { kind: 'complete' },
    });
    const progress = await readCapsuleProgress(fixture);
    expect(progress.at(-1)).toMatchObject({ kind: 'capsule-start-failed', stage: 'persistence' });
    expect(progress.some((event) => event.kind === 'capsule-ready')).toBe(false);
  } finally {
    await fixture.close();
  }
});

it('drains early observations before recording a rejected Compose acquisition', async () => {
  const fixture = await requestFixture(() => Promise.resolve());
  await new Promise<void>((resolve) =>
    fixture.manager.server.close(() => {
      resolve();
    }),
  );
  try {
    await runCapsuleManager(fixture, {
      catalog: {
        load: () => Promise.resolve(catalogFixture(fixture.projectDirectory)),
        resolve: ({ catalog, systemId }) =>
          resolveCatalogEntry({
            catalog,
            selection: { kind: 'explicit-entry', entryId: systemId },
          }),
      },
      sandbox: {
        projectName: () => 'test-compose',
        start: (input) => {
          if (input.progress.kind !== 'events') {
            throw new Error('Expected progress sink');
          }
          input.progress.sink.emit({
            kind: 'acquisition-observation',
            sandboxId: fixture.executionId,
            projectName: 'test-compose',
            at: 'now',
            observation: {
              kind: 'resource-discovered',
              resource: { kind: 'network', name: 'owned-network' },
            },
          });
          return Promise.reject(new Error('Compose refused startup'));
        },
      },
      now: () => new Date(),
    });
    const progress = await readCapsuleProgress(fixture);
    expect(progress.at(-2)).toMatchObject({
      kind: 'acquisition-observation',
      observation: { kind: 'resource-discovered' },
    });
    expect(progress.at(-1)).toMatchObject({
      kind: 'capsule-start-failed',
      stage: 'acquisition',
      cause: { message: 'Compose refused startup' },
    });
  } finally {
    await fixture.close();
  }
});

it('retains both failures in the session record when acquisition and the progress journal fail', async () => {
  const fixture = await requestFixture(() => Promise.resolve());
  await new Promise<void>((resolve) =>
    fixture.manager.server.close(() => {
      resolve();
    }),
  );
  try {
    await expect(
      runCapsuleManager(fixture, {
        catalog: {
          load: () => Promise.resolve(catalogFixture(fixture.projectDirectory)),
          resolve: ({ catalog, systemId }) =>
            resolveCatalogEntry({
              catalog,
              selection: { kind: 'explicit-entry', entryId: systemId },
            }),
        },
        sandbox: {
          projectName: () => 'test-compose',
          start: async (input) => {
            await rm(capsuleProgressPath(fixture));
            await mkdir(capsuleProgressPath(fixture));
            if (input.progress.kind !== 'events') {
              throw new Error('Expected progress sink');
            }
            input.progress.sink.emit({
              kind: 'acquisition-observation',
              sandboxId: fixture.executionId,
              projectName: 'test-compose',
              at: 'now',
              observation: { kind: 'waiting', elapsedMs: 0 },
            });
            throw new Error('Compose refused startup');
          },
        },
        now: () => new Date(),
      }),
    ).rejects.toMatchObject({ code: 'EISDIR' });
    const record = await readCapsuleRecord(fixture);
    expect(record).toMatchObject({ state: 'start-failed', cleanup: { kind: 'not-attempted' } });
    expect(record.failure.kind).toBe('recorded');
    if (record.failure.kind !== 'recorded') {
      throw new Error('Expected a retained manager failure');
    }
    expect(record.failure.error.message).toContain('Acquisition failed: Compose refused startup');
    expect(record.failure.error.message).toContain('progress persistence failed:');
  } finally {
    await fixture.close();
  }
});
