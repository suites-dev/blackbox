/** Reader functions are registered synchronously and invoked only during capture. */
export type StateReaders = Readonly<Record<string, () => unknown>>;
export type StateValues<R extends StateReaders> = {
  readonly [K in keyof R]: DeepReadonly<Awaited<ReturnType<R[K]>>>;
};
export type DeepReadonly<T> = T extends readonly (infer V)[]
  ? readonly DeepReadonly<V>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;
export type StateDiff<R extends StateReaders> = {
  readonly [K in keyof R]: StateValueDiff<StateValues<R>[K]>;
};
export type StateValueDiff<T> = [T] extends [readonly (infer Row)[]]
  ? {
      readonly added: readonly Row[];
      readonly removed: readonly Row[];
      readonly changed: readonly { readonly before: Row; readonly after: Row }[];
    }
  : { readonly before: T; readonly after: T; readonly changed: boolean };

declare const observerType: unique symbol;
export interface StateObserver<R extends StateReaders> {
  readonly [observerType]: R;
}
export interface BlackboxState {
  observe<R extends StateReaders>(name: string, readers: R): StateObserver<R>;
}
export interface StateFailure {
  readonly observer: string;
  readonly reader: string;
  readonly reason: 'reader-failed' | 'invalid-value' | 'missing-id' | 'duplicate-id';
}
export interface StateCheckpoint {
  readonly id: string;
}
export interface StateCapture {
  readonly checkpoint: StateCheckpoint;
  readonly failures: readonly StateFailure[];
}
export interface StateComparison<R extends StateReaders> {
  readonly initial: StateValues<R>;
  readonly final: StateValues<R>;
  readonly diff: StateDiff<R>;
}
export interface StateSelection {
  capture(): Promise<StateCapture>;
  initial<R extends StateReaders>(
    checkpoint: StateCheckpoint,
    observer: StateObserver<R>,
  ): StateValues<R>;
  between<R extends StateReaders>(
    initial: StateCheckpoint,
    final: StateCheckpoint,
    observer: StateObserver<R>,
  ): StateComparison<R>;
  serialize(checkpoint: StateCheckpoint, redact: (value: string) => string): SerializedCheckpoint;
  serializeObserver<R extends StateReaders>(
    checkpoint: StateCheckpoint,
    observer: StateObserver<R>,
    redact: (value: string) => string,
  ): SerializedCheckpoint;
  serializeBetweenObserver<R extends StateReaders>(
    initial: StateCheckpoint,
    final: StateCheckpoint,
    observer: StateObserver<R>,
    redact: (value: string) => string,
  ): SerializedComparison;
  serializeBetween(
    initial: StateCheckpoint,
    final: StateCheckpoint,
    redact: (value: string) => string,
  ): SerializedComparison;
}
export type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export interface SerializedCheckpoint {
  readonly version: 1;
  readonly checkpointId: string;
  readonly failureCount: number;
  readonly observers: readonly {
    readonly name: string;
    readonly readers: readonly (
      | { readonly name: string; readonly status: 'captured'; readonly value: JsonValue }
      | { readonly name: string; readonly status: 'failed' }
    )[];
  }[];
}
export interface SerializedComparison {
  readonly version: 1;
  readonly initialCheckpointId: string;
  readonly finalCheckpointId: string;
  readonly observers: readonly (
    | { readonly name: string; readonly status: 'captured'; readonly diff: JsonValue }
    | { readonly name: string; readonly status: 'failed' }
  )[];
}
export interface StateRegistry {
  readonly state: BlackboxState;
  select(): StateSelection;
  close(): void;
}
