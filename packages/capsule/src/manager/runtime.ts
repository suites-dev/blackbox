import { randomBytes } from 'node:crypto';
import { mkdir, unlink } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { dirname, join } from 'node:path';

import type { SandboxHandle } from '@suites/blackbox-sandbox-internal';
import type { CatalogSandboxInput } from '@suites/blackbox-catalog-internal';

import type { CapsuleManagerBootstrap } from '../protocol.js';
import {
  readCapsuleActivities,
  readCapsuleRecord,
  recordedError,
  writeCapsuleRecord,
  type CapsuleSessionRecord,
} from '../records.js';
import type {
  CapsuleActivityReport,
  CapsuleEntrypoint,
  CapsuleManagerOwnership,
} from '../types.js';
import { completePlannedSandbox, startPlannedSandbox } from './acquisition.js';
import { emitProgress, runStartStage } from './progress.js';
import type { CapsuleManagerPorts } from './ports.js';
import type { CapsuleTelemetryAuthorization } from './telemetry.js';
import { requireCollectorRuntime } from './collector-runtime.js';

export interface RunningManager {
  readonly server: Server;
  readonly sandbox: SandboxHandle;
  readonly entrypoint: CapsuleEntrypoint;
  readonly telemetryAuthorization: CapsuleTelemetryAuthorization;
  readonly drivers: CatalogSandboxInput['drivers'];
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

function createTelemetryAuthorization(): CapsuleTelemetryAuthorization {
  return {
    kind: 'split-bearer-tokens',
    ingestToken: randomBytes(32).toString('base64url'),
    controlToken: randomBytes(32).toString('base64url'),
  };
}

function startedManager(): CapsuleManagerOwnership {
  return {
    kind: 'started',
    pid: process.pid,
    identity: {
      kind: 'socket-instance',
      instanceId: randomBytes(32).toString('base64url'),
    },
  };
}

async function resolveCollectorRuntime(ports: CapsuleManagerPorts) {
  return runStartStage('acquisition', async () =>
    requireCollectorRuntime(await ports.collectorRuntime.resolve()),
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
    transition(record, 'sandbox-starting', {
      manager: startedManager(),
    }),
  );
  let sandbox: SandboxHandle | undefined;
  const telemetryAuthorization = createTelemetryAuthorization();
  try {
    const collectorRuntime = await resolveCollectorRuntime(ports);
    const acquisition = await startPlannedSandbox({
      bootstrap,
      plan,
      entry,
      ports,
      authorization: telemetryAuthorization,
      collectorRuntime,
    });
    sandbox = acquisition.sandbox;
    await acquisition.flushProgress();
    const acquired = await completePlannedSandbox({
      bootstrap,
      plan,
      entry,
      ports,
      authorization: telemetryAuthorization,
      collectorRuntime,
      sandbox,
    });
    record = await persist(
      bootstrap.projectDirectory,
      transition(record, 'running', {
        entrypoint: { kind: 'available', value: acquired.entrypoint },
        containers: acquired.containers,
        composeProject: { kind: 'available', value: sandbox.projectName },
        networks: acquired.networks,
        volumes: acquired.volumes,
        readiness: { kind: 'available', value: acquired.readiness },
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
      telemetryAuthorization,
      drivers: plan.drivers,
      record,
      activities: [...(await readCapsuleActivities(bootstrap))],
    };
  } catch (error) {
    const cleanup = await cleanupFailedSandbox(sandbox);
    await persist(
      bootstrap.projectDirectory,
      transition(record, 'start-failed', {
        failure: { kind: 'recorded', error: recordedError(error) },
        cleanup,
      }),
    );
    server.close();
    await unlink(record.socketPath).catch(() => undefined);
    throw error;
  }
}
