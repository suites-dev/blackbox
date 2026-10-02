import type { CollectorFailure } from './failure.js';
import type { RetainedFragmentSummary, TraceFragment } from './fragments.js';
import type { CollectorIdentity } from './identity.js';
import type { CollectorLifecycleRecord } from './lifecycle.js';

export interface ReadCollectorSessionInput extends CollectorIdentity {
  readonly storageDirectory: string;
}

export interface ReadCollectorTraceInput extends ReadCollectorSessionInput {
  readonly traceId: string;
}

export interface ReadCollectorActivityInput extends ReadCollectorSessionInput {
  readonly activityId: string;
}

export type CollectorSessionReadResult =
  | {
      readonly kind: 'collector-session-found';
      readonly lifecycle: CollectorLifecycleRecord;
      readonly fragments: readonly RetainedFragmentSummary[];
      readonly traceIds: readonly string[];
    }
  | {
      readonly kind: 'collector-session-missing';
      readonly identity: CollectorIdentity;
      readonly message: string;
    }
  | {
      readonly kind: 'collector-session-corrupt';
      readonly identity: CollectorIdentity;
      readonly error: CollectorFailure;
    };

export type CollectorTraceReadResult =
  | {
      readonly kind: 'collector-trace-found';
      readonly identity: CollectorIdentity;
      readonly traceId: string;
      readonly fragments: readonly TraceFragment[];
    }
  | {
      readonly kind: 'collector-trace-missing';
      readonly identity: CollectorIdentity;
      readonly traceId: string;
      readonly message: string;
    }
  | {
      readonly kind: 'collector-trace-corrupt';
      readonly identity: CollectorIdentity;
      readonly traceId: string;
      readonly error: CollectorFailure;
    };

export type CollectorTracesReadResult =
  | {
      readonly kind: 'collector-traces-found';
      readonly identity: CollectorIdentity;
      readonly traces: readonly {
        readonly traceId: string;
        readonly fragments: readonly TraceFragment[];
      }[];
    }
  | {
      readonly kind: 'collector-traces-missing';
      readonly identity: CollectorIdentity;
      readonly message: string;
    }
  | {
      readonly kind: 'collector-traces-corrupt';
      readonly identity: CollectorIdentity;
      readonly error: CollectorFailure;
    };

export type CollectorSnapshotReadResult =
  | {
      readonly kind: 'collector-snapshot-found';
      readonly identity: CollectorIdentity;
      readonly lifecycle: CollectorLifecycleRecord;
      readonly fragments: readonly RetainedFragmentSummary[];
      readonly traces: readonly {
        readonly traceId: string;
        readonly fragments: readonly TraceFragment[];
      }[];
    }
  | {
      readonly kind: 'collector-snapshot-missing';
      readonly identity: CollectorIdentity;
      readonly message: string;
    }
  | {
      readonly kind: 'collector-snapshot-corrupt';
      readonly identity: CollectorIdentity;
      readonly error: CollectorFailure;
    };

export type CollectorActivityReadResult =
  | {
      readonly kind: 'collector-activity-found';
      readonly identity: CollectorIdentity;
      readonly activityId: string;
      readonly fragments: readonly TraceFragment[];
      readonly traceIds: readonly string[];
    }
  | {
      readonly kind: 'collector-activity-missing';
      readonly identity: CollectorIdentity;
      readonly activityId: string;
      readonly message: string;
    }
  | {
      readonly kind: 'collector-activity-corrupt';
      readonly identity: CollectorIdentity;
      readonly activityId: string;
      readonly error: CollectorFailure;
    };
