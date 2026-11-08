import type { APIRequestContext } from '@playwright/test';
import type { LazyEffectCapture } from '../../effects/emissions/lazy/types.js';
import type { StateComparison, StateObserver, StateReaders, StateValues } from '../../state/types.js';

export type WhenTitle = `When ${string}`;
export type GivenTitle = `Given ${string}`;
export type VerifyTitle = `Then ${string}` | `And ${string}`;
export type InitialState = <R extends StateReaders>(observer: StateObserver<R>) => StateValues<R>;
export type ExecutionEvidence = {
  state<R extends StateReaders>(observer: StateObserver<R>): StateComparison<R>;
} & Readonly<Partial<{ effects: LazyEffectCapture }>>;
export interface ExecutionResult<T> {
  readonly result: T;
  readonly evidence: ExecutionEvidence;
  readonly verify: <V>(title: VerifyTitle, callback: () => V | Promise<V>) => Promise<V>;
}
export type Stimulus = <T>(title: WhenTitle, action: (scope: { readonly request: APIRequestContext; readonly headers: Readonly<Record<string, string>> }) => T | Promise<T>, options?: Readonly<Partial<{ precondition: { readonly name: GivenTitle; readonly check: (scope: { readonly initial: InitialState }) => unknown } }>>) => Promise<ExecutionResult<T>>;
