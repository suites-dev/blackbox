import { mkdir, unlink } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { dirname, join } from 'node:path';

import type { SandboxHandle } from '@suites/blackbox-sandbox-internal';

import type { CapsuleManagerBootstrap } from '../protocol.js';
import {
  readCapsuleActivities,
  readCapsuleRecord,
  recordedError,
  writeCapsuleRecord,
  type CapsuleSessionRecord,
} from '../records.js';
import type { CapsuleActivityReport, CapsuleEntrypoint } from '../types.js';
import { completePlannedSandbox, startPlannedSandbox } from './acquisition.js';
import { emitProgress, runStartStage } from './progress.js';
import type { CapsuleManagerPorts } from './ports.js';

export interface RunningManager {
  readonly server: Server;
  readonly sandbox: SandboxHandle;
  readonly entrypoint: CapsuleEntrypoint;
  readonly participantServices: ReadonlyMap<string, string>;
  activities: CapsuleActivityReport[];
  record: CapsuleSessionRecord;
}

export function transition(
  record: CapsuleSessionRecord,
  state: CapsuleSessionRecord['state'],
  update: Partial<CapsuleSessionRecord> = {},
): CapsuleSessionRecord {
  return {
    ...record,
    ...update,
    state,
    revision: record.revision + 1,
    updatedAt: new Date().toISOString(),
  };
}

export async function persist(
  projectDirectory: string,
  record: CapsuleSessionRecord,
): Promise<CapsuleSessionRecord> {
  await writeCapsuleRecord({ projectDirectory, record });
  return record;
}

async function openServer(socketPath: string): Promise<Server> {
  await mkdir(dirname(socketPath), { recursive: true, mode: 0o700 });
  await unlink(socketPath).catch((error: unknown) => {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw error;
    }
  });
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  return server;
}

async function resolvePlan(bootstrap: CapsuleManagerBootstrap, ports: CapsuleManagerPorts) {
  const configFile = join(bootstrap.projectDirectory, 'blackbox.config.yaml');
  await emitProgress(bootstrap, {
    kind: 'catalog-selected',
    sessionId: bootstrap.sessionId,
    system: bootstrap.systemId,
    configFile,
  });
  const catalog = await runStartStage('catalog-load', () => ports.catalog.load({ configFile }));
  const plan = await runStartStage('catalog-resolution', () =>
    Promise.resolve(ports.catalog.resolve({ catalog, systemId: bootstrap.systemId })),
  );
  await emitProgress(bootstrap, {
    kind: 'catalog-resolved',
    sessionId: bootstrap.sessionId,
    system: bootstrap.systemId,
    projectDirectory: plan.projectDirectory,
    composeFiles: plan.composeFiles,
    services: plan.services,
  });
  return { plan, entry: catalog.config.catalog.entries[bootstrap.systemId] };
}

async function cleanupFailedSandbox(sandbox: SandboxHandle | undefined) {
  if (sandbox === undefined) {
    return { kind: 'not-attempted' } as const;
  }
  return sandbox.stop({ reason: 'failed' }).then(
    () => ({ kind: 'complete' }) as const,
    (cause: unknown) => ({ kind: 'failed', error: recordedError(cause) }) as const,
  );
}

export async function prepareManager(
  bootstrap: CapsuleManagerBootstrap,
  ports: CapsuleManagerPorts,
): Promise<RunningManager> {
  let record = await readCapsuleRecord(bootstrap);
  const { plan, entry } = await resolvePlan(bootstrap, ports);
  const server = await runStartStage('manager-handshake', () => openServer(record.socketPath));
  await emitProgress(bootstrap, {
    kind: 'manager-ready',
    sessionId: bootstrap.sessionId,
    managerPid: process.pid,
  });
  record = await persist(
    bootstrap.projectDirectory,
    transition(record, 'sandbox-starting', { managerPid: process.pid }),
  );
  let sandbox: SandboxHandle | undefined;
  try {
    const acquisition = await startPlannedSandbox({ bootstrap, plan, entry, ports });
    sandbox = acquisition.sandbox;
    await acquisition.flushProgress();
    const acquired = await completePlannedSandbox({ bootstrap, plan, entry, ports, sandbox });
    record = await persist(
      bootstrap.projectDirectory,
      transition(record, 'running', {
        entrypoint: acquired.entrypoint,
        containers: acquired.containers,
        composeProject: sandbox.projectName,
        networks: acquired.networks,
        volumes: acquired.volumes,
        readiness: acquired.readiness,
      }),
    );
    await emitProgress(bootstrap, {
      kind: 'capsule-ready',
      sessionId: bootstrap.sessionId,
      durationMs: Date.now() - Date.parse(record.admittedAt),
    });
    return {
      server,
      sandbox,
      entrypoint: acquired.entrypoint,
      record,
      participantServices: new Map(
        Object.entries(entry.participants).map(([id, value]) => [id, value.service]),
      ),
      activities: [...(await readCapsuleActivities(bootstrap))],
    };
  } catch (error) {
    const cleanup = await cleanupFailedSandbox(sandbox);
    await persist(
      bootstrap.projectDirectory,
      transition(record, 'start-failed', { error: recordedError(error), cleanup }),
    );
    server.close();
    await unlink(record.socketPath).catch(() => undefined);
    throw error;
  }
}
