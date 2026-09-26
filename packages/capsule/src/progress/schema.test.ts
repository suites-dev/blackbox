import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { capsuleSessionDirectory } from '../records.js';
import { decodeCapsuleProgress, capsuleProgressSchema } from './schema.js';
import { appendCapsuleProgress, capsuleProgressPath, readCapsuleProgress } from './store.js';

const event = {
  kind: 'acquisition-observation',
  sessionId: 'test',
  sequence: 1,
  stage: 'acquisition',
  at: 'now',
  observation: { kind: 'waiting', elapsedMs: 5000 },
};
const document = { schemaVersion: 1, kind: 'capsule-progress', events: [event] };

it('exports a schema and rejects unsupported versions, malformed observations, and wrong identities', () => {
  expect(capsuleProgressSchema).toMatchObject({
    $id: expect.stringContaining('capsule-progress-v1'),
  });
  expect(decodeCapsuleProgress({ document, sessionId: 'test' })).toEqual([event]);
  for (const invalid of [
    { ...document, schemaVersion: 2 },
    { ...document, events: [{ ...event, observation: { kind: 'waiting', elapsedMs: -1 } }] },
    { ...document, events: [{ ...event, observation: { kind: 'pass' } }] },
    { ...document, events: [{ ...event, sessionId: 'foreign' }] },
    { ...document, events: [{ ...event, sequence: 2 }] },
  ]) {
    expect(() => decodeCapsuleProgress({ document: invalid, sessionId: 'test' })).toThrow();
  }
});

it('reads legacy arrays and writes the versioned artifact without changing earlier events', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'capsule-progress-migration-'));
  const input = { projectDirectory, sessionId: 'test' };
  try {
    await mkdir(capsuleSessionDirectory(input), { recursive: true });
    await writeFile(capsuleProgressPath(input), JSON.stringify([event]));
    expect(await readCapsuleProgress(input)).toEqual([event]);
    await appendCapsuleProgress({
      ...input,
      event: {
        kind: 'acquisition-observation',
        sessionId: 'test',
        observation: { kind: 'observation-status', status: 'unavailable' },
      },
    });
    const retained = JSON.parse(await readFile(capsuleProgressPath(input), 'utf8'));
    expect(retained).toMatchObject({
      schemaVersion: 1,
      kind: 'capsule-progress',
      events: [event, { sequence: 2 }],
    });
    expect(await readCapsuleProgress(input)).toHaveLength(2);
  } finally {
    await rm(projectDirectory, { recursive: true, force: true });
  }
});
