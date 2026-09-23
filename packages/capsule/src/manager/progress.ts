import type { CapsuleManagerBootstrap } from '../protocol.js';
import { appendCapsuleProgress, type CapsuleProgressEmission } from '../progress/store.js';
import type { CapsuleStartFailureStage } from '../types.js';

export class CapsuleStageError extends Error {
  constructor(
    readonly stage: CapsuleStartFailureStage,
    readonly source: unknown,
  ) {
    super(source instanceof Error ? source.message : String(source), { cause: source });
    this.name = 'CapsuleStageError';
  }
}

export async function emitProgress(
  bootstrap: CapsuleManagerBootstrap,
  event: CapsuleProgressEmission,
): Promise<void> {
  await appendCapsuleProgress({
    projectDirectory: bootstrap.projectDirectory,
    sessionId: bootstrap.sessionId,
    event,
  });
}

export async function runStartStage<Value>(
  stage: CapsuleStartFailureStage,
  operation: () => Promise<Value>,
): Promise<Value> {
  try {
    return await operation();
  } catch (error) {
    throw new CapsuleStageError(stage, error);
  }
}
