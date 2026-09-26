import { clearInterval, setInterval } from 'node:timers';
import { utimes } from 'node:fs/promises';
import { readLock } from '../io.js';
import { releaseOwnedLock } from './release.js';

export interface LeaseHeartbeat {
  readonly assertOwned: () => Promise<void>;
  readonly release: () => Promise<void>;
}

function ownershipError(): Error {
  return new Error('Collector storage lease ownership was lost.');
}

async function verifyOwnership(input: {
  readonly path: string;
  readonly token: string;
}): Promise<void> {
  const lock = await readLock(input.path);
  if (
    lock.kind !== 'lock-read' ||
    lock.decoded.kind !== 'lock-record-decoded' ||
    lock.decoded.record.kind !== 'collector-storage-lock-v2' ||
    lock.decoded.record.token !== input.token
  ) {
    throw ownershipError();
  }
}

export function startLeaseHeartbeat(input: {
  readonly path: string;
  readonly token: string;
  readonly intervalMs: number;
}): LeaseHeartbeat {
  let compromised: Error | null = null;
  let updating = false;
  const beat = async (): Promise<void> => {
    if (updating || compromised !== null) {
      return;
    }
    updating = true;
    try {
      const now = new Date();
      await utimes(input.path, now, now);
    } catch {
      compromised = ownershipError();
    } finally {
      updating = false;
    }
  };
  const timer = setInterval(() => void beat(), input.intervalMs);
  timer.unref();
  return {
    assertOwned: async () => {
      if (compromised !== null) {
        throw compromised;
      }
      await verifyOwnership(input);
    },
    release: async () => {
      clearInterval(timer);
      await releaseOwnedLock(input);
    },
  };
}
