import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { readCapsuleObservations } from './observations.js';
import { readCapsuleActivityObservations } from './activity-observations.js';
import { cleanObservationFixtures, collectorFixture, collectorStorage, postTrace,
  sessionFixture, traceId } from './testing/observations.fixture.js';

afterEach(cleanObservationFixtures);

it('reads exact retained session, activity, and trace observations from the Capsule identity', async () => {
  const fixture = await sessionFixture('quiet-river-ada', 'activity-7');
  const collector = await collectorFixture(fixture);
  await postTrace(collector, 'activity-7');

  await expect(
    readCapsuleObservations({ ...fixture, selection: { kind: 'session' } }),
  ).resolves.toMatchObject({
    kind: 'collector-session-found',
    fragments: [{ sequence: 1, spanCount: 2 }],
    traceIds: [traceId],
  });
  await expect(
    readCapsuleObservations({
      ...fixture,
      selection: { kind: 'activity', activityId: 'activity-7' },
    }),
  ).resolves.toMatchObject({
    kind: 'collector-activity-found',
    activityId: 'activity-7',
    traceIds: [traceId],
  });
  await expect(
    readCapsuleObservations({ ...fixture, selection: { kind: 'trace', traceId } }),
  ).resolves.toMatchObject({ kind: 'collector-trace-found', traceId });
});

it('distinguishes missing exact selections from a corrupt retained collector lifecycle', async () => {
  const missing = await sessionFixture('gentle-forest-zoe');
  await expect(
    readCapsuleObservations({ ...missing, selection: { kind: 'session' } }),
  ).resolves.toMatchObject({ kind: 'collector-session-missing' });
  await expect(
    readCapsuleObservations({
      ...missing,
      selection: { kind: 'activity', activityId: 'missing-activity' },
    }),
  ).resolves.toMatchObject({ kind: 'collector-activity-missing' });
  await expect(
    readCapsuleObservations({ ...missing, selection: { kind: 'trace', traceId } }),
  ).resolves.toMatchObject({ kind: 'collector-trace-missing' });

  const corrupt = await sessionFixture('rapid-harbor-alex', 'activity-1');
  const directory = join(collectorStorage(corrupt), corrupt.sessionId, corrupt.executionId);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'collector-lifecycle.json'), '{not-json');
  await expect(
    readCapsuleObservations({ ...corrupt, selection: { kind: 'session' } }),
  ).resolves.toMatchObject({ kind: 'collector-session-corrupt' });
  await expect(
    readCapsuleObservations({
      ...corrupt,
      selection: { kind: 'activity', activityId: 'activity-1' },
    }),
  ).resolves.toMatchObject({ kind: 'collector-activity-corrupt' });
  await expect(
    readCapsuleObservations({ ...corrupt, selection: { kind: 'trace', traceId } }),
  ).resolves.toMatchObject({ kind: 'collector-trace-corrupt' });
});

it('reads the exact activity trace including descendants without an activity attribute', async () => {
  const fixture = await sessionFixture('calm-river-ada', 'activity-7');
  const collector = await collectorFixture(fixture);
  await postTrace(collector, 'activity-7');
  const expanded = await readCapsuleActivityObservations({ ...fixture, activityId: 'activity-7' });
  expect(expanded.kind).toBe('collector-activity-found');
  expect(JSON.stringify(expanded)).toContain('downstream-api');
  const direct = await readCapsuleObservations({
    ...fixture,
    selection: { kind: 'activity', activityId: 'activity-7' },
  });
  expect(JSON.stringify(direct)).toContain('downstream-api');
  await expect(
    readCapsuleActivityObservations({ ...fixture, activityId: 'activity-8' }),
  ).resolves.toMatchObject({ kind: 'collector-activity-missing' });
});
