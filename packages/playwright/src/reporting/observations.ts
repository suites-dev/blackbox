import { readCollectorLifecycle } from '@suites/blackbox-otel-collector';
import { sandboxTelemetryStorageDirectory } from '@suites/blackbox-sandbox';

import type { RunningBlackboxAttempt } from '../runtime/acquisition.js';
import type { AttemptProgress } from './events.js';

export async function reportObservations(
  progress: AttemptProgress,
  { sandbox, telemetry }: Pick<RunningBlackboxAttempt, 'sandbox' | 'telemetry'>,
): Promise<void> {
  try {
    const result = await readCollectorLifecycle({
      sessionId: telemetry.sessionId,
      executionId: telemetry.executionId,
      storageDirectory: sandboxTelemetryStorageDirectory({
        recordDirectory: sandbox.artifactDirectory,
        sandboxId: sandbox.sandboxId,
      }),
    });
    if (result.kind !== 'collector-lifecycle-found') {
      progress.emit('observations', 'info', result.kind);
      return;
    }
    const counts = result.lifecycle.telemetry;
    progress.emit(
      'observations',
      'info',
      `${counts.acceptedRequests} requests; ${counts.acceptedSpans} spans`,
    );
    const latest = result.lifecycle.runs.at(-1);
    if (latest !== undefined) {
      progress.emit(
        'collector',
        latest.shutdown === 'complete' ? 'completed' : 'info',
        `shutdown ${latest.shutdown}`,
      );
    }
  } catch {
    progress.emit('observations', 'info', 'retained telemetry unavailable');
  }
}
