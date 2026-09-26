import { resolveCatalogEntry } from '@suites/blackbox-catalog-internal';
import { expect, it } from 'vitest';

import { runCapsuleManager } from '../../manager.js';
import { readCapsuleProgress } from '../../progress/store.js';
import { readCapsuleRecord } from '../../records.js';
import { catalogFixture } from './acquisition.fixture.js';
import { requestFixture } from './request.fixture.js';

it('fails acquisition without reporting ready when the collector runtime is unavailable', async () => {
  const fixture = await requestFixture(() => Promise.resolve());
  await new Promise<void>((resolve) =>
    fixture.manager.server.close(() => {
      resolve();
    }),
  );
  try {
    await runCapsuleManager(fixture, {
      collectorRuntime: {
        resolve: () =>
          Promise.resolve({
            kind: 'unavailable',
            error: { name: 'CollectorRuntimeUnavailable', message: 'main.js is missing' },
          }),
      },
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
        start: () => Promise.reject(new Error('Sandbox must not start')),
      },
      now: () => new Date(),
    });
    await expect(readCapsuleRecord(fixture)).resolves.toMatchObject({
      state: 'start-failed',
      cleanup: { kind: 'not-attempted' },
      failure: {
        kind: 'recorded',
        error: { message: 'CollectorRuntimeUnavailable: main.js is missing' },
      },
    });
    const progress = await readCapsuleProgress(fixture);
    expect(progress.some(({ kind }) => kind === 'capsule-ready')).toBe(false);
    expect(progress.at(-1)).toMatchObject({
      kind: 'capsule-start-failed',
      stage: 'acquisition',
    });
  } finally {
    await fixture.close();
  }
});
