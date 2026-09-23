import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { capsuleSessionDirectory } from '../records.js';
import { deliverProgress } from '../session/start.js';
import { appendCapsuleProgress, capsuleProgressPath, readCapsuleProgress } from './store.js';

const roots: string[] = [];

async function progressFixture() {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'capsule-progress-'));
  roots.push(projectDirectory);
  const sessionId = 'flying-suite-jacob';
  await mkdir(capsuleSessionDirectory({ projectDirectory, sessionId }), { recursive: true });
  return { projectDirectory, sessionId };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Capsule startup progress journal', () => {
  it('orders persisted events and never records environment values', async () => {
    vi.stubEnv('API_TOKEN', 'secret-value');
    const fixture = await progressFixture();
    await appendCapsuleProgress({
      ...fixture,
      event: {
        kind: 'session-admitted',
        sessionId: fixture.sessionId,
        system: 'orders',
        artifactRoot: '/artifact',
        environmentKeys: ['API_TOKEN'],
      },
    });
    await appendCapsuleProgress({
      ...fixture,
      event: {
        kind: 'readiness-started',
        sessionId: fixture.sessionId,
        url: 'http://localhost/health',
        timeoutMs: 1000,
      },
    });
    await appendCapsuleProgress({
      ...fixture,
      event: {
        kind: 'capsule-start-failed',
        sessionId: fixture.sessionId,
        stage: 'readiness',
        cause: { name: 'TimeoutError', message: 'health timed out' },
      },
    });

    const events = await readCapsuleProgress(fixture);
    expect(events.map(({ sequence, kind, stage }) => ({ sequence, kind, stage }))).toEqual([
      { sequence: 1, kind: 'session-admitted', stage: 'admission' },
      { sequence: 2, kind: 'readiness-started', stage: 'readiness' },
      { sequence: 3, kind: 'capsule-start-failed', stage: 'readiness' },
    ]);
    expect(await readFile(capsuleProgressPath(fixture), 'utf8')).not.toContain('secret-value');
  });
});

describe('Capsule live progress forwarding', () => {
  it('journals in silent mode and forwards new IPC batches before readiness', async () => {
    const fixture = await progressFixture();
    await appendCapsuleProgress({
      ...fixture,
      event: { kind: 'manager-ready', sessionId: fixture.sessionId, managerPid: 123 },
    });
    const firstBatch = await readCapsuleProgress(fixture);
    const received: string[] = [];
    let delivered = deliverProgress(
      { kind: 'non-interactive', sink: (event) => received.push(event.kind) },
      firstBatch,
      0,
    );
    await appendCapsuleProgress({
      ...fixture,
      event: {
        kind: 'readiness-started',
        sessionId: fixture.sessionId,
        url: 'http://localhost/health',
        timeoutMs: 1000,
      },
    });
    delivered = deliverProgress(
      { kind: 'interactive', sink: (event) => received.push(event.kind) },
      await readCapsuleProgress(fixture),
      delivered,
    );
    expect(received).toEqual(['manager-ready', 'readiness-started']);
    expect(deliverProgress({ kind: 'silent' }, await readCapsuleProgress(fixture), 0)).toBe(2);
    expect(delivered).toBe(2);
  });
});

describe('Capsule progress sink isolation', () => {
  it('contains sink failures without changing the lifecycle stream', async () => {
    const fixture = await progressFixture();
    await appendCapsuleProgress({
      ...fixture,
      event: { kind: 'manager-ready', sessionId: fixture.sessionId, managerPid: 123 },
    });
    const events = await readCapsuleProgress(fixture);
    expect(() =>
      deliverProgress(
        {
          kind: 'interactive',
          sink: () => {
            throw new Error('terminal closed');
          },
        },
        events,
        0,
      ),
    ).not.toThrow();
    expect(await readCapsuleProgress(fixture)).toEqual(events);
  });
});
