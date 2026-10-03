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

it('accepts the start-up phase, awaited endpoints, participant exits, stop steps and the policy', () => {
  const base = { sessionId: 'test', at: 'now' };
  const events = [
    {
      ...base,
      ...event,
      observation: {
        kind: 'waiting-for-endpoints',
        elapsedMs: 5000,
        awaiting: [{ service: 'api', containerPort: 8080 }],
      },
    },
    {
      ...base,
      sequence: 2,
      stage: 'acquisition',
      kind: 'acquisition-completed',
      durationMs: 4200,
      startupTimeoutMs: 120000,
    },
    {
      ...base,
      sequence: 3,
      stage: 'running',
      kind: 'participant-exited',
      participant: 'db',
      service: 'orders-db',
      containerName: 'orders-db-1',
      containerId: 'db-id',
      state: 'missing',
      exitCode: null,
    },
    { ...base, sequence: 4, stage: 'stop', kind: 'capsule-stop-requested', reason: 'completed' },
    { ...base, sequence: 5, stage: 'stop', kind: 'capsule-stopped', cleanup: 'complete' },
    {
      ...base,
      sequence: 6,
      stage: 'catalog',
      kind: 'observation-policy-resolved',
      policy: {
        policyId: 'orders-v1',
        boundaries: [{ id: 'effects.http', kind: 'http', authoritativeFor: ['HTTP'] }],
        requiredBoundaries: ['effects.http'],
        terminalObservationWindowMs: 5000,
        redaction: { requestBodies: 'not-captured', headers: [], dynamicIdentifiers: 'kept' },
      },
    },
  ];
  const progress = { ...document, events };
  expect(decodeCapsuleProgress({ document: progress, sessionId: 'test' })).toEqual(events);
  const wrongStage = {
    ...progress,
    events: [events[0], events[1], { ...events[2], stage: 'ready' }],
  };
  expect(() => decodeCapsuleProgress({ document: wrongStage, sessionId: 'test' })).toThrow();
});
