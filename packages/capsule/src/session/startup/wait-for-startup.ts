import type { ChildProcess } from 'node:child_process';
import { appendCapsuleProgress, readCapsuleProgress } from '../../progress/store.js';
import type { CapsuleProgressMode } from '../../progress/events.js';
import { readCapsuleRecord, writeCapsuleRecord, type CapsuleSessionRecord } from '../../records.js';
import { reconcileDeadCapsuleManager } from '../recovery/index.js';
import { managerTermination } from './manager-termination.js';

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

export async function waitForStartup(
  input: {
    readonly projectDirectory: string;
    readonly sessionId: string;
    readonly manager: ChildProcess;
    readonly progress: CapsuleProgressMode;
  },
  ports = { readProgress: readCapsuleProgress, readRecord: readCapsuleRecord },
): Promise<CapsuleSessionRecord> {
  let delivered = 0;
  for (;;) {
    delivered = deliverProgress(input.progress, await ports.readProgress(input), delivered);
    const record = await ports.readRecord(input);
    if (['running', 'start-failed', 'manager-failed'].includes(record.state)) {
      // A terminal record may become visible after the preceding journal read.
      deliverProgress(input.progress, await ports.readProgress(input), delivered);
      return record;
    }
    const termination = managerTermination(input.manager);
    if (termination.kind === 'manager-terminated') {
      const reconciliation = await reconcileDeadCapsuleManager(input);
      const failed =
        reconciliation.kind === 'capsule-manager-reconciled'
          ? reconciliation.record
          : ({
              ...record,
              state: 'manager-failed',
              revision: record.revision + 1,
              updatedAt: new Date().toISOString(),
              failure: { kind: 'recorded', error: termination.error },
            } satisfies CapsuleSessionRecord);
      if (reconciliation.kind !== 'capsule-manager-reconciled') {
        await writeCapsuleRecord({ projectDirectory: input.projectDirectory, record: failed });
      }
      await appendCapsuleProgress({
        ...input,
        event: {
          kind: 'capsule-start-failed',
          sessionId: input.sessionId,
          stage: 'manager-handshake',
          cause: failed.failure.kind === 'recorded' ? failed.failure.error : termination.error,
        },
      });
      return failed;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
