import type { EffectCapture, EffectRecorder, EffectSelector } from '@suites/blackbox-effects';

/** A stimulus-owned query. It has no occurrences or coverage until an assertion reads a cut. */
export interface LazyEffectRecorder {
  readonly kind: 'lazy-effect-selection';
  readonly selector: EffectSelector;
}
type Method = 'http' | 'rpc' | 'db' | 'cache' | 'message' | 'business' | 'internal' | 'span';
export type LazyEffectCapture = {
  readonly [Key in Method]: (...fields: Parameters<EffectCapture[Key]>) => LazyEffectRecorder;
} & { capture(): Promise<EffectCapture> };

export interface LazyEffectProvider {
  /** Reject foreign attempts and expired fixtures before any read or write. */
  check(): void;
  run<T>(operation: () => Promise<T>): Promise<T>;
  read(timeoutMs: number): Promise<EffectCapture>;
  retain(capture: EffectCapture): Promise<void>;
}
export interface LazySelection {
  readonly provider: LazyEffectProvider;
  readonly select: (capture: EffectCapture) => EffectRecorder;
}
export type EmissionSelection = EffectRecorder | LazyEffectRecorder;
