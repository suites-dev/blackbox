import type { CapsuleRecordedError } from './recorded-error.js';

export type CapsuleDescription =
  { readonly kind: 'provided'; readonly value: string } | { readonly kind: 'omitted' };

export type CapsuleAvailability<Value> =
  { readonly kind: 'available'; readonly value: Value } | { readonly kind: 'unavailable' };

export type CapsuleManagerOwnership =
  | { readonly kind: 'not-started' }
  | {
      readonly kind: 'started';
      readonly pid: number;
      readonly identity:
        | { readonly kind: 'legacy-pid-only' }
        | { readonly kind: 'socket-instance'; readonly instanceId: string };
    };

export type CapsuleFailureRecord =
  { readonly kind: 'none' } | { readonly kind: 'recorded'; readonly error: CapsuleRecordedError };

export type CapsuleCleanupReport =
  | { readonly kind: 'not-attempted' }
  | { readonly kind: 'complete' }
  | { readonly kind: 'failed'; readonly error: CapsuleRecordedError };
