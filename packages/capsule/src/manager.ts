import type { CapsuleManagerBootstrap } from './protocol.js';
import { serveManager } from './manager/requests.js';
import { CapsuleStageError } from './manager/progress.js';
import type { CapsuleManagerPorts } from './manager/ports.js';
import { prepareManager, persist, transition } from './manager/runtime.js';
import { appendCapsuleProgress } from './progress/store.js';
import { readCapsuleRecord, recordedError } from './records.js';

export async function runCapsuleManager(
  bootstrap: CapsuleManagerBootstrap,
  ports: CapsuleManagerPorts,
): Promise<void> {
  try {
    serveManager(bootstrap, await prepareManager(bootstrap, ports));
  } catch (error) {
    const record = await readCapsuleRecord(bootstrap);
    const stage = error instanceof CapsuleStageError ? error.stage : 'manager-handshake';
    const source = error instanceof CapsuleStageError ? error.source : error;
    await appendCapsuleProgress({
      projectDirectory: bootstrap.projectDirectory,
      sessionId: bootstrap.sessionId,
      event: {
        kind: 'capsule-start-failed',
        sessionId: bootstrap.sessionId,
        stage,
        cause: recordedError(source),
      },
    });
    if (record.state !== 'start-failed') {
      await persist(
        bootstrap.projectDirectory,
        transition(record, 'manager-failed', { error: recordedError(source) }),
      );
    }
  }
}
