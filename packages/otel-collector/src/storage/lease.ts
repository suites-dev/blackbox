import { mkdir } from 'node:fs/promises';
import { fragmentDirectory, lockDirectoryPath, lockPath, sessionDirectory } from './paths.js';
import { claimLock } from './lease/claim.js';
import { createLeaseRuntime } from './lease/process-instance.js';
import { startLeaseHeartbeat } from './lease/lifecycle/heartbeat.js';
import type { CollectorStorageLease, LeaseRuntime, StorageLeaseInput } from './lease/types.js';

export type { CollectorStorageLease } from './lease/types.js';

export async function acquireStorageLeaseWithRuntime(input: {
  readonly lease: StorageLeaseInput;
  readonly runtime: LeaseRuntime;
}): Promise<CollectorStorageLease> {
  const lease = input.lease;
  const legacyPath = lockPath(lease);
  const directory = lockDirectoryPath(lease);
  const token = input.runtime.createToken();
  const record = {
    kind: 'collector-storage-lock-v2',
    owner: input.runtime.currentOwner,
    token,
    createdAt: input.runtime.now(),
  } as const;
  await mkdir(sessionDirectory(lease), { recursive: true, mode: 0o700 });
  await mkdir(fragmentDirectory(lease), { recursive: true, mode: 0o700 });
  const ownedPath = await claimLock({
    legacyPath,
    directory,
    record,
    runtime: input.runtime,
    ...lease,
  });
  const heartbeat = startLeaseHeartbeat({
    path: ownedPath,
    token,
    intervalMs: input.runtime.heartbeatIntervalMs,
  });
  return {
    ...lease,
    token,
    assertOwned: heartbeat.assertOwned,
    release: heartbeat.release,
  };
}

export async function acquireStorageLease(input: StorageLeaseInput): Promise<CollectorStorageLease> {
  const runtime = await createLeaseRuntime();
  return acquireStorageLeaseWithRuntime({ lease: input, runtime });
}
