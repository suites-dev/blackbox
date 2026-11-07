import type { JsonValue, StateCheckpoint } from './types.js';

export interface Entry {
  readonly name: string;
  readonly readers: readonly (readonly [string, () => unknown])[];
  readonly handle: object;
}
export type Reading =
  | { readonly name: string; readonly status: 'captured'; readonly value: JsonValue }
  | { readonly name: string; readonly status: 'failed' };
export interface Snapshot { readonly id: string; readonly readings: ReadonlyMap<Entry, readonly Reading[]> }
export interface StateProjection {
  readonly selected: readonly Entry[];
  snapshot(checkpoint: StateCheckpoint): Snapshot;
  compare(initial: StateCheckpoint, final: StateCheckpoint, entry: Entry): { readonly diff: Record<string, JsonValue> };
}
