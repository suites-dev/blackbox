import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capsuleSessionDirectory } from '@suites/blackbox-capsule';

export interface FixtureActivity {
  readonly activityId: string;
  readonly traceId: string;
  readonly name: string | null;
  readonly exitCode: number;
}

export interface FixtureCapsule {
  readonly sessionId: string;
  readonly state: 'running' | 'stopped';
  readonly system: string;
  readonly admittedAt: string;
  readonly activities: readonly FixtureActivity[];
}

export function fixtureActivity(activityId: string, traceId: string, name: string | null = null) {
  return { activityId, traceId, name, exitCode: 0 } satisfies FixtureActivity;
}

function activityRecord(activity: FixtureActivity, sequence: number) {
  const context = {
    kind: 'w3c-trace-context',
    traceId: activity.traceId,
    spanId: '2222222222222222',
    traceFlags: '01',
    traceparent: `00-${activity.traceId}-2222222222222222-01`,
    traceState: { kind: 'trace-state-absent' },
  };
  return {
    kind: 'completed',
    activityId: activity.activityId,
    sequence,
    name: activity.name === null ? { kind: 'omitted' } : { kind: 'provided', value: activity.name },
    purpose: 'stimulus',
    target: { kind: 'host' },
    argv: ['true'],
    telemetry: {
      schemaVersion: 1,
      kind: 'telemetry-execution-scope-completed-v1',
      executionId: activity.activityId,
      operationName: `capsule.activity.${activity.activityId}`,
      startedAt: '2026-01-01T00:00:02.000Z',
      endedAt: '2026-01-01T00:00:03.000Z',
      result: { kind: 'telemetry-scope-succeeded' },
      context,
    },
    outcome: {
      kind: 'exited',
      propagation: {
        schemaVersion: 1,
        kind: 'telemetry-propagation-v1',
        expectation: { kind: 'propagation-not-requested' },
        outcome: { kind: 'context-not-injected', reason: 'raw-command' },
      },
      argv: ['true'],
      location: { kind: 'host' },
      exitCode: activity.exitCode,
      stdout: '',
      stderr: '',
      retention: {
        stdout: { kind: 'complete', originalBytes: 0 },
        stderr: { kind: 'complete', originalBytes: 0 },
      },
    },
    startedAt: '2026-01-01T00:00:02.000Z',
    completedAt: '2026-01-01T00:00:03.000Z',
  };
}

async function writeCapsule(directory: string, capsule: FixtureCapsule): Promise<string> {
  const artifactRoot = capsuleSessionDirectory({
    projectDirectory: directory,
    sessionId: capsule.sessionId,
  });
  await mkdir(artifactRoot, { recursive: true });
  const socketPath = join(directory, `${capsule.sessionId.slice(-4)}.sock`);
  const record = {
    schemaVersion: 1,
    sessionId: capsule.sessionId,
    executionId: '00000000-0000-4000-8000-000000000001',
    system: capsule.system,
    title: `${capsule.system} demo`,
    description: { kind: 'omitted' },
    state: capsule.state,
    revision: 1,
    admittedAt: capsule.admittedAt,
    updatedAt: capsule.admittedAt,
    manager: { kind: 'started', pid: process.pid },
    socketPath,
    entrypoint: {
      kind: 'available',
      value: { url: 'http://127.0.0.1:4567', host: '127.0.0.1', port: 4567, protocol: 'http' },
    },
    artifactRoot,
    containers: [],
    networks: [],
    volumes: [],
    cleanup: { kind: capsule.state === 'stopped' ? 'complete' : 'not-attempted' },
    failure: { kind: 'none' },
    composeProject: { kind: 'available', value: `capsule-${capsule.sessionId}` },
    readiness: {
      kind: 'available',
      value: { url: 'http://127.0.0.1:4567/health', status: 'ready', durationMs: 10 },
    },
  };
  await writeFile(join(artifactRoot, 'session.json'), JSON.stringify(record));
  await writeFile(
    join(artifactRoot, 'activities.json'),
    JSON.stringify(
      capsule.activities.map((activity, index) => activityRecord(activity, index + 1)),
    ),
  );
  await writeFile(
    join(artifactRoot, 'progress.json'),
    JSON.stringify({ schemaVersion: 1, kind: 'capsule-progress', events: [] }),
  );
  return socketPath;
}

/** A project with several retained capsules and activities, built on disk only. */
export async function projectFixture(capsules: readonly FixtureCapsule[]) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'bb-surface-')));
  await writeFile(join(directory, 'blackbox.config.yaml'), 'schemaVersion: 1\n');
  const sockets = new Map<string, string>();
  for (const capsule of capsules) {
    sockets.set(capsule.sessionId, await writeCapsule(directory, capsule));
  }
  return {
    directory,
    socket: (sessionId: string) => sockets.get(sessionId) ?? '',
    remove: () => rm(directory, { recursive: true, force: true }),
  };
}

export const CAPSULE_A = 'calm-comet-ada-000000000001';
export const CAPSULE_B = 'gentle-willow-zoe-000000000002';
export const ACTIVITY_A = '3f9a2c41-7b00-4000-8000-00000000000a';
export const ACTIVITY_A2 = '3f9a2c41-7c00-4000-8000-00000000000b';
export const ACTIVITY_B = '9b1e0d77-0000-4000-8000-00000000000c';
export const TRACE_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
export const TRACE_A2 = 'abababababababababababababababab';
export const TRACE_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

/** Two running capsules: A (older) holds two activities sharing an 8-hex prefix, B holds one. */
export function twoCapsuleProject() {
  return projectFixture([
    {
      sessionId: CAPSULE_A,
      state: 'running',
      system: 'orders',
      admittedAt: '2026-01-01T00:00:00.000Z',
      activities: [
        fixtureActivity(ACTIVITY_A, TRACE_A, 'Create order'),
        fixtureActivity(ACTIVITY_A2, TRACE_A2),
      ],
    },
    {
      sessionId: CAPSULE_B,
      state: 'running',
      system: 'payments',
      admittedAt: '2026-01-02T00:00:00.000Z',
      activities: [fixtureActivity(ACTIVITY_B, TRACE_B)],
    },
  ]);
}
