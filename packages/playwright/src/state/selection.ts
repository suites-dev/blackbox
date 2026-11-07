import type { Entry, Reading, Snapshot } from './internal.js';
import { randomUUID } from 'node:crypto';
import { types } from 'node:util';
import { diffValue, StateIdentityError, validateValue } from './diff.js';
import { serializeCheckpoint, serializeComparison } from './serialization.js';
import { copyValue } from './value.js';
import type {
  JsonValue,
  StateCapture,
  StateCheckpoint,
  StateComparison,
  StateFailure,
  StateObserver,
  StateReaders,
  StateSelection,
  StateValues,
} from './types.js';

export class StateSelectionImpl implements StateSelection {
  private readonly snapshots = new WeakMap<StateCheckpoint, Snapshot>();
  constructor(
    readonly selected: readonly Entry[],
    private readonly active: () => void,
  ) {}
  private find(observer: object): Entry {
    this.active();
    const entry = this.selected.find((item) => item.handle === observer);
    if (entry === undefined) {
      throw new Error('State observer is foreign or was registered after selection');
    }
    return entry;
  }
  snapshot(checkpoint: StateCheckpoint): Snapshot {
    this.active();
    const value = this.snapshots.get(checkpoint);
    if (value === undefined) {
      throw new Error('State checkpoint is foreign to this selection');
    }
    return value;
  }
  values(checkpoint: StateCheckpoint, entry: Entry): Record<string, JsonValue> {
    const readings = this.snapshot(checkpoint).readings.get(entry);
    if (readings === undefined || readings.some((reading) => reading.status === 'failed')) {
      throw new Error('State observation capture failed');
    }
    return Object.freeze(
      Object.fromEntries(
        readings.map((reading) => [
          reading.name,
          reading.status === 'captured' ? reading.value : null,
        ]),
      ),
    );
  }
  compare(initial: StateCheckpoint, final: StateCheckpoint, entry: Entry) {
    const before = this.values(initial, entry);
    const after = this.values(final, entry);
    const diff = Object.freeze(
      Object.fromEntries(entry.readers.map(([key]) => [key, diffValue(before[key], after[key])])),
    );
    return Object.freeze({ initial: before, final: after, diff });
  }
  async capture(): Promise<StateCapture> {
    this.active();
    const readings = new Map<Entry, readonly Reading[]>();
    const failures: StateFailure[] = [];
    let bytes = 0;
    for (const entry of this.selected) {
      const captured: Reading[] = [];
      for (const [name, read] of entry.readers) {
        this.active();
        let raw: unknown;
        try {
          raw = read();
          if (types.isPromise(raw)) {
            raw = await raw;
          }
        } catch {
          failures.push(
            Object.freeze({ observer: entry.name, reader: name, reason: 'reader-failed' }),
          );
          captured.push(Object.freeze({ name, status: 'failed' }));
          continue;
        }
        this.active();
        try {
          const value = copyValue(raw);
          validateValue(value);
          const size = Buffer.byteLength(JSON.stringify(value));
          if (bytes + size > 1_000_000) {
            throw new Error('State checkpoint exceeds limits');
          }
          bytes += size;
          captured.push(Object.freeze({ name, status: 'captured', value }));
        } catch (error) {
          failures.push(
            Object.freeze({
              observer: entry.name,
              reader: name,
              reason: error instanceof StateIdentityError ? error.reason : 'invalid-value',
            }),
          );
          captured.push(Object.freeze({ name, status: 'failed' }));
        }
      }
      readings.set(entry, Object.freeze(captured));
    }
    this.active();
    const checkpoint = Object.freeze({ id: randomUUID() });
    this.snapshots.set(checkpoint, { id: checkpoint.id, readings });
    return Object.freeze({ checkpoint, failures: Object.freeze(failures) });
  }
  initial<R extends StateReaders>(
    checkpoint: StateCheckpoint,
    observer: StateObserver<R>,
  ): StateValues<R> {
    return this.values(checkpoint, this.find(observer)) as StateValues<R>;
  }
  between<R extends StateReaders>(
    initial: StateCheckpoint,
    final: StateCheckpoint,
    observer: StateObserver<R>,
  ): StateComparison<R> {
    return this.compare(initial, final, this.find(observer)) as StateComparison<R>;
  }
  serialize(checkpoint: StateCheckpoint, redact: (value: string) => string) {
    return serializeCheckpoint(this, checkpoint, redact);
  }
  serializeObserver<R extends StateReaders>(
    checkpoint: StateCheckpoint,
    observer: StateObserver<R>,
    redact: (value: string) => string,
  ) {
    return serializeCheckpoint(this, checkpoint, redact, [this.find(observer)]);
  }
  serializeBetweenObserver<R extends StateReaders>(
    initial: StateCheckpoint,
    final: StateCheckpoint,
    observer: StateObserver<R>,
    redact: (value: string) => string,
  ) {
    return serializeComparison(this, { initial, final }, redact, [this.find(observer)]);
  }
  serializeBetween(
    initial: StateCheckpoint,
    final: StateCheckpoint,
    redact: (value: string) => string,
  ) {
    return serializeComparison(this, { initial, final }, redact);
  }
}
