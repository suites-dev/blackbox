import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import type { CapsuleManagerBootstrap } from '../protocol.js';
import { appendCapsuleProgress, readCapsuleProgress } from '../progress/store.js';
import { canonicalProjectDirectory, capsuleFailure } from './validation.js';
import {
  admitCapsuleRecord,
  capsuleSocketPath,
  readCapsuleRecord,
  writeCapsuleRecord,
  capsuleSessionDirectory,
  type CapsuleSessionRecord,
} from '../records.js';
import type { CapsuleProgressMode, CapsuleStartInput, CapsuleStartResult } from '../types.js';
import { generateCapsuleIdentity } from './identity.js';

export function deliverProgress(
  progress: CapsuleProgressMode,
  events: Awaited<ReturnType<typeof readCapsuleProgress>>,
  delivered: number,
): number {
  if (progress.kind === 'silent') {
    return events.length;
  }
  for (const event of events.slice(delivered)) {
    try {
      progress.sink(event);
    } catch {
      /* Presentation cannot change lifecycle truth. */
    }
  }
  return events.length;
}

async function waitForStartup(input: {
  readonly projectDirectory: string;
  readonly sessionId: string;
  readonly manager: ChildProcess;
  readonly progress: CapsuleProgressMode;
}): Promise<CapsuleSessionRecord> {
  let delivered = 0;
  for (;;) {
    delivered = deliverProgress(input.progress, await readCapsuleProgress(input), delivered);
    const record = await readCapsuleRecord(input);
    if (['running', 'start-failed', 'manager-failed'].includes(record.state)) {
      return record;
    }
    if (input.manager.exitCode !== null) {
      const failed = {
        ...record,
        state: 'manager-failed',
        revision: record.revision + 1,
        updatedAt: new Date().toISOString(),
        failure: {
          kind: 'recorded',
          error: {
            name: 'CapsuleManagerExit',
            message: `Capsule manager exited with code ${input.manager.exitCode}`,
          },
        },
      } satisfies CapsuleSessionRecord;
      await writeCapsuleRecord({ projectDirectory: input.projectDirectory, record: failed });
      await appendCapsuleProgress({
        ...input,
        event: {
          kind: 'capsule-start-failed',
          sessionId: input.sessionId,
          stage: 'manager-handshake',
          cause: failed.failure.error,
        },
      });
      return failed;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function launchManager(bootstrap: CapsuleManagerBootstrap): Promise<ChildProcess> {
  const managerPath = fileURLToPath(new URL('../manager-entry.js', import.meta.url));
  const child = spawn(process.execPath, [managerPath], {
    detached: true,
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  child.stdin.on('error', () => undefined);
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.stdin.end(JSON.stringify(bootstrap), () => {
      child.unref();
      resolve();
    });
  });
  return child;
}

function candidateRecord(input: {
  readonly start: CapsuleStartInput;
  readonly projectDirectory: string;
  readonly identity: ReturnType<typeof generateCapsuleIdentity>;
}): CapsuleSessionRecord {
  const admittedAt = new Date().toISOString();
  const artifactRoot = capsuleSessionDirectory({
    projectDirectory: input.projectDirectory,
    sessionId: input.identity.sessionId,
  });
  return {
    schemaVersion: 1,
    sessionId: input.identity.sessionId,
    executionId: input.identity.executionId,
    system: input.start.systemId,
    title: input.start.title,
    description: input.start.description,
    state: 'admitted',
    revision: 0,
    admittedAt,
    updatedAt: admittedAt,
    manager: { kind: 'not-started' },
    socketPath: capsuleSocketPath({
      projectDirectory: input.projectDirectory,
      sessionId: input.identity.sessionId,
    }),
    entrypoint: { kind: 'unavailable' },
    containers: [],
    cleanup: { kind: 'not-attempted' },
    failure: { kind: 'none' },
    composeProject: { kind: 'unavailable' },
    artifactRoot,
    networks: [],
    volumes: [],
    readiness: { kind: 'unavailable' },
  };
}

export async function reserveCapsuleRecord(input: {
  readonly start: CapsuleStartInput;
  readonly projectDirectory: string;
  readonly generateIdentity: () => ReturnType<typeof generateCapsuleIdentity>;
}): Promise<CapsuleSessionRecord> {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const candidate = candidateRecord({
      start: input.start,
      projectDirectory: input.projectDirectory,
      identity: input.generateIdentity(),
    });
    try {
      await admitCapsuleRecord({ projectDirectory: input.projectDirectory, record: candidate });
      return candidate;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
        throw error;
      }
    }
  }
  throw new Error('Could not reserve a unique Capsule session identity');
}

async function admitAndLaunch(
  input: CapsuleStartInput,
  projectDirectory: string,
): Promise<{ readonly manager: ChildProcess; readonly sessionId: string }> {
  const record = await reserveCapsuleRecord({
    start: input,
    projectDirectory,
    generateIdentity: generateCapsuleIdentity,
  });
  const sessionId = record.sessionId;
  await appendCapsuleProgress({
    projectDirectory,
    sessionId,
    event: {
      kind: 'session-admitted',
      sessionId,
      system: input.systemId,
      artifactRoot: record.artifactRoot,
      environmentKeys: Object.keys(input.environment).sort(),
    },
  });
  const managerStarting = {
    ...record,
    state: 'manager-starting',
    revision: 1,
    updatedAt: new Date().toISOString(),
  } satisfies CapsuleSessionRecord;
  await writeCapsuleRecord({ projectDirectory, record: managerStarting });
  const manager = await launchManager({
    projectDirectory,
    sessionId,
    executionId: record.executionId,
    systemId: input.systemId,
    environment: { ...input.environment },
  });
  await appendCapsuleProgress({
    projectDirectory,
    sessionId,
    event: { kind: 'manager-spawned', sessionId, managerPid: manager.pid ?? -1 },
  });
  return { manager, sessionId };
}

export async function startCapsule(input: CapsuleStartInput): Promise<CapsuleStartResult> {
  let sessionId = 'unadmitted-capsule';
  try {
    const projectDirectory = await canonicalProjectDirectory(input.projectDirectory);
    const admitted = await admitAndLaunch(input, projectDirectory);
    sessionId = admitted.sessionId;
    const started = await waitForStartup({
      projectDirectory,
      sessionId,
      manager: admitted.manager,
      progress: input.progress,
    });
    if (
      started.state !== 'running' ||
      started.entrypoint.kind !== 'available' ||
      started.composeProject.kind !== 'available' ||
      started.readiness.kind !== 'available'
    ) {
      return {
        kind: 'capsule-operation-failed',
        operation: 'start',
        sessionId,
        error:
          started.failure.kind === 'recorded'
            ? started.failure.error
            : { name: 'Error', message: `Capsule startup ended in ${started.state}` },
      };
    }
    return {
      kind: 'capsule-started',
      sessionId,
      system: started.system,
      title: started.title,
      composeProject: started.composeProject.value,
      artifactRoot: started.artifactRoot,
      entrypoint: started.entrypoint.value,
      containers: started.containers,
      networks: started.networks,
      volumes: started.volumes,
      readiness: started.readiness.value,
    };
  } catch (error) {
    return capsuleFailure({ operation: 'start', sessionId, error });
  }
}
