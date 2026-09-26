import { mkdir, utimes, writeFile } from 'node:fs/promises';
import type { CurrentLockRecord } from '../record.js';
import type {
  LeaseRuntime,
  LinuxProcessOwner,
  ProcessOwner,
  ProcessInspection,
  StorageLeaseInput,
} from '../types.js';
import { lockDirectoryPath, lockPath, sessionDirectory } from '../../paths.js';
import { candidatePath } from '../candidate.js';

export function testLeaseInput(root: string): StorageLeaseInput {
  return {
    storageDirectory: root,
    sessionId: 'test-session',
    executionId: 'test-execution',
  };
}

export function testOwner(input: {
  readonly pid: number;
  readonly startTimeTicks: string;
}): LinuxProcessOwner {
  return testOwnerInNamespace({ ...input, pidNamespace: 'pid:[test-namespace]' });
}

export function testOwnerInNamespace(input: {
  readonly pid: number;
  readonly startTimeTicks: string;
  readonly pidNamespace: string;
}): LinuxProcessOwner {
  return {
    kind: 'linux-process-instance',
    pid: input.pid,
    pidNamespace: input.pidNamespace,
    bootId: 'test-boot-id',
    startTimeTicks: input.startTimeTicks,
  };
}

export function testRuntime(input: {
  readonly currentOwner: ProcessOwner;
  readonly inspections: readonly ProcessInspection[];
  readonly token: string;
}): LeaseRuntime {
  const current =
    input.currentOwner.kind === 'linux-process-instance'
      ? { kind: 'process-instance-observed', owner: input.currentOwner } as const
      : { kind: 'process-alive-unidentified', pid: input.currentOwner.pid } as const;
  return {
    currentOwner: input.currentOwner,
    inspectProcess: async ({ pid }) => {
      const match = input.inspections.find((inspection) =>
        inspection.kind === 'process-instance-observed'
          ? inspection.owner.pid === pid
          : inspection.pid === pid,
      );
      return Promise.resolve(match ?? (pid === input.currentOwner.pid ? current : {
        kind: 'process-inspection-unavailable',
        pid,
      }));
    },
    createToken: () => input.token,
    now: () => '2026-09-26T00:00:00.000Z',
    nowMilliseconds: Date.now,
    heartbeatIntervalMs: 5000,
    staleAfterMs: 30_000,
  };
}

export function testRecord(input: {
  readonly owner: LinuxProcessOwner;
  readonly token: string;
}): CurrentLockRecord {
  return {
    kind: 'collector-storage-lock-v2',
    owner: input.owner,
    token: input.token,
    createdAt: '2026-09-25T00:00:00.000Z',
  };
}

export async function writeTestLock(input: {
  readonly lease: StorageLeaseInput;
  readonly value: unknown;
}): Promise<string> {
  await mkdir(sessionDirectory(input.lease), { recursive: true });
  const path = lockPath(input.lease);
  await writeFile(path, `${JSON.stringify(input.value)}\n`, 'utf8');
  return path;
}

export async function writeTestCandidate(input: {
  readonly lease: StorageLeaseInput;
  readonly record: CurrentLockRecord;
  readonly state: 'claiming' | 'owned';
}): Promise<string> {
  const directory = lockDirectoryPath(input.lease);
  await mkdir(directory, { recursive: true });
  const path = candidatePath({ directory, token: input.record.token, state: input.state });
  await writeFile(path, `${JSON.stringify(input.record)}\n`, 'utf8');
  return path;
}

export async function expireTestCandidate(path: string): Promise<void> {
  const expired = new Date(0);
  await utimes(path, expired, expired);
}
