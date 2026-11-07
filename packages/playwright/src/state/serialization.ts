import type { Entry, Reading, Snapshot, StateProjection } from './internal.js';
import { copyValue, redactValue } from './value.js';
import type { SerializedCheckpoint, SerializedComparison, StateCheckpoint } from './types.js';

function safeText(value: string, redact: (value: string) => string): string {
  if (typeof redact !== 'function') {
    throw new Error('State serialization requires a redactor');
  }
  const output = redact(value);
  if (typeof output !== 'string' || output.length > 16_384) {
    throw new Error('Invalid state redaction');
  }
  return output;
}
function getReadings(snap: Snapshot, entry: Entry): readonly Reading[] {
  const readings = snap.readings.get(entry);
  if (readings === undefined) {
    throw new Error('State checkpoint is incomplete');
  }
  return readings;
}
export function serializeCheckpoint(
  selection: StateProjection,
  checkpoint: StateCheckpoint,
  redact: (value: string) => string,
  entries: readonly Entry[] = selection.selected,
): SerializedCheckpoint {
  if (typeof redact !== 'function') {
    throw new Error('State serialization requires a redactor');
  }
  const snap = selection.snapshot(checkpoint);
  const observers = entries.map((entry) => ({
    name: safeText(entry.name, redact),
    readers: getReadings(snap, entry).map((reading) =>
      reading.status === 'failed'
        ? { name: safeText(reading.name, redact), status: 'failed' as const }
        : {
            name: safeText(reading.name, redact),
            status: 'captured' as const,
            value: redactValue(reading.value, (value) => safeText(value, redact)),
          },
    ),
  }));
  const result = {
    version: 1 as const,
    checkpointId: snap.id,
    failureCount: observers
      .flatMap((observer) => observer.readers)
      .filter((reader) => reader.status === 'failed').length,
    observers,
  };
  copyValue(result);
  return result;
}
export function serializeComparison(
  selection: StateProjection,
  checkpoints: { readonly initial: StateCheckpoint; readonly final: StateCheckpoint },
  redact: (value: string) => string,
  entries: readonly Entry[] = selection.selected,
): SerializedComparison {
  if (typeof redact !== 'function') {
    throw new Error('State serialization requires a redactor');
  }
  const { initial, final } = checkpoints;
  const first = selection.snapshot(initial);
  const last = selection.snapshot(final);
  const observers = entries.map((entry) => {
    const failed = [first, last].some((snap) =>
      getReadings(snap, entry).some((reading) => reading.status === 'failed'),
    );
    if (failed) {
      return { name: safeText(entry.name, redact), status: 'failed' as const };
    }
    return {
      name: safeText(entry.name, redact),
      status: 'captured' as const,
      diff: redactValue(selection.compare(initial, final, entry).diff, (value) =>
        safeText(value, redact),
      ),
    };
  });
  const result = {
    version: 1 as const,
    initialCheckpointId: first.id,
    finalCheckpointId: last.id,
    observers,
  };
  copyValue(result);
  return result;
}
