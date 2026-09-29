import type { CollectorFailure, CollectorIdentity, CollectorLifecycleRecord } from './types.js';

/**
 * One retained fragment's exact decompressed OTLP JSON text. Consumers that
 * must hash or re-derive facts from retained bytes use this instead of the
 * filtered trace views, which re-serialize partitioned requests.
 */
export interface RetainedFragmentContent {
  readonly sequence: number;
  readonly receivedAt: string;
  readonly rawJson: string;
}

export type CollectorFragmentsReadResult =
  | {
      readonly kind: 'collector-fragments-found';
      readonly identity: CollectorIdentity;
      readonly lifecycle: CollectorLifecycleRecord;
      readonly fragments: readonly RetainedFragmentContent[];
    }
  | {
      readonly kind: 'collector-fragments-missing';
      readonly identity: CollectorIdentity;
      readonly message: string;
    }
  | {
      readonly kind: 'collector-fragments-corrupt';
      readonly identity: CollectorIdentity;
      readonly error: CollectorFailure;
    };
