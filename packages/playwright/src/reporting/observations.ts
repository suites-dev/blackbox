import type { BlackboxTelemetry } from '../types.js';
import type { AttemptProgress } from './events.js';

export async function reportObservations(
  progress: AttemptProgress,
  telemetry: BlackboxTelemetry,
): Promise<void> {
  try {
    const result = await telemetry.read();
    if (result.kind !== 'collector-session-found') {
      progress.emit('observations', 'info', result.kind);
      return;
    }
    const counts = result.lifecycle.telemetry;
    progress.emit(
      'observations',
      'info',
      `${counts.acceptedRequests} requests; ${counts.acceptedSpans} spans; ${result.traceIds.length} traces`,
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
