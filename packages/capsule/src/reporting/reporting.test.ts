import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  admitCapsuleRecord,
  capsuleActivityPath,
  capsuleRecordPath,
  capsuleSessionDirectory,
  type CapsuleSessionRecord,
} from '../records.js';
import { reportCapsule } from '../session/operations.js';
import type { CapsuleActivityReport, CapsuleSessionState } from '../types.js';
import { serializeCapsuleReportDocument } from './serialization.js';

const roots: string[] = [];

function record(input: {
  readonly projectDirectory: string;
  readonly sessionId: string;
  readonly state: CapsuleSessionState;
}): CapsuleSessionRecord {
  const at = '2026-09-23T12:00:00.000Z';
  return {
    schemaVersion: 1,
    sessionId: input.sessionId,
    executionId: '11111111-1111-4111-8111-111111111111',
    system: 'orders',
    title: undefined,
    description: 'Operational session API_TOKEN=description-token',
    state: input.state,
    revision: 2,
    admittedAt: at,
    updatedAt: at,
    managerPid: undefined,
    socketPath: join(input.projectDirectory, '.blackbox/s/private.sock'),
    entrypoint: { url: 'http://localhost:4123?token=url-token', host: 'localhost', port: 4123, protocol: 'http' },
    containers: [{ participant: 'api', service: 'api', containerId: 'abc', containerName: 'api-1', host: 'localhost', networkNames: ['orders_default'] }],
    cleanup: input.state === 'stopped' ? { kind: 'complete' } : { kind: 'not-attempted' },
    error: input.state.endsWith('failed') ? { name: 'Error', message: 'Bearer manager-token at /tmp/.blackbox/s/private.sock' } : undefined,
    composeProject: 'orders-project',
    artifactRoot: capsuleSessionDirectory(input),
    networks: ['orders_default'],
    volumes: ['orders_data'],
    readiness: { url: 'http://localhost:4123/health?api_key=readiness-token', status: 'ready', durationMs: 20 },
  };
}

const activity = {
  sequence: 1,
  target: 'host',
  participant: undefined,
  argv: ['curl', '--header', 'Authorization: Bearer capsule-e2e-token', 'API_TOKEN=raw-token'],
  outcome: {
    kind: 'exited',
    argv: ['curl', '--header', 'Authorization: Bearer capsule-e2e-token', '--token', 'raw-token'],
    exitCode: 0,
    stdout: '{"token":"response-token","status":"ok"}',
    stderr: '/tmp/.blackbox/s/manager.sock TOKEN=output-token',
  },
  startedAt: '2026-09-23T12:01:00.000Z',
  completedAt: '2026-09-23T12:01:01.000Z',
} satisfies CapsuleActivityReport;

async function fixture(sessionId: string, state: CapsuleSessionState) {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'capsule-report-'));
  roots.push(projectDirectory);
  await writeFile(join(projectDirectory, 'blackbox.config.yaml'), 'schemaVersion: 1\n');
  await admitCapsuleRecord({ projectDirectory, record: record({ projectDirectory, sessionId, state }) });
  await writeFile(capsuleActivityPath({ projectDirectory, sessionId }), JSON.stringify([activity]));
  return { projectDirectory, sessionId };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function expectSafeJson(json: string): void {
  expect(json).toContain('capsule-operational-report');
  expect(json).toContain('[REDACTED]');
  for (const secret of [
    'capsule-e2e-token',
    'response-token',
    'raw-token',
    'manager.sock',
    'description-token',
    'url-token',
    'readiness-token',
    'output-token',
    'executionId',
    'socketPath',
  ]) {
    expect(json).not.toContain(secret);
  }
}

async function admitOtherSession(input: {
  readonly projectDirectory: string;
  readonly sessionId: string;
}): Promise<void> {
  await admitCapsuleRecord({
    projectDirectory: input.projectDirectory,
    record: record({ ...input, state: 'running' }),
  });
}

describe('Capsule operational report', () => {
  it('projects exact retained data and removes credentials from every presentation input', async () => {
    const selected = await fixture('bright-river-ada', 'stopped');
    await admitOtherSession({
      projectDirectory: selected.projectDirectory,
      sessionId: 'quiet-forest-grace',
    });
    const result = await reportCapsule(selected);
    expect(result.kind).toBe('capsule-report');
    if (result.kind !== 'capsule-report') {
      return;
    }
    expect(result.document.session.sessionId).toBe('bright-river-ada');
    expect(result.document.lifecycle).toEqual({ kind: 'stopped', retainedState: 'stopped' });
    expect(result.document.resources.networks).toEqual(['orders_default']);
    expect(result.document.redactions.count).toBeGreaterThanOrEqual(6);
    const json = serializeCapsuleReportDocument({ document: result.document });
    expectSafeJson(json);
  });

  it.each([
    ['admitted', 'starting'],
    ['manager-starting', 'starting'],
    ['sandbox-starting', 'starting'],
    ['stopping', 'stopping'],
    ['start-failed', 'failed'],
    ['manager-failed', 'failed'],
    ['stop-failed', 'failed'],
    ['running', 'running'],
  ] as const)('represents %s records as %s', async (state, kind) => {
    const selected = await fixture(`steady-comet-${state.replaceAll('-', '')}`, state);
    const result = await reportCapsule(selected);
    expect(result).toMatchObject({ kind: 'capsule-report', document: { lifecycle: { kind } } });
  });
});

describe('Capsule report artifact failures', () => {
  it('returns explicit missing and corrupt artifact failures', async () => {
    const selected = await fixture('calm-river-maya', 'stopped');
    await writeFile(capsuleActivityPath(selected), '{not-json');
    await expect(reportCapsule(selected)).resolves.toMatchObject({
      kind: 'capsule-report-artifact-failed',
      artifact: 'activities',
      sessionId: selected.sessionId,
    });
    await expect(
      reportCapsule({ projectDirectory: selected.projectDirectory, sessionId: 'calm-river-noah' }),
    ).resolves.toMatchObject({ kind: 'capsule-not-found' });
  });

  it('distinguishes corrupt progress from a missing optional journal', async () => {
    const selected = await fixture('flying-summit-grace', 'running');
    const progressPath = join(capsuleSessionDirectory(selected), 'progress.json');
    await mkdir(capsuleSessionDirectory(selected), { recursive: true });
    await writeFile(progressPath, 'not-json');
    await expect(reportCapsule(selected)).resolves.toMatchObject({
      kind: 'capsule-report-artifact-failed',
      artifact: 'progress',
    });
  });

  it('identifies a corrupt exact session record', async () => {
    const selected = await fixture('rapid-harbor-alex', 'stopped');
    await writeFile(capsuleRecordPath(selected), 'not-json');
    await expect(reportCapsule(selected)).resolves.toMatchObject({
      kind: 'capsule-report-artifact-failed',
      artifact: 'session',
    });
  });
});
