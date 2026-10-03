import type { W3CTraceContext } from '@suites/blackbox-telemetry';

export type ActivityPurpose = 'setup' | 'stimulus' | 'inspection';

export interface OwnedActivity {
  readonly activityId: string;
  readonly purpose: ActivityPurpose;
  readonly context: W3CTraceContext;
}

export interface ActivitySelection {
  readonly scopeId: string;
  readonly sessionId: string;
  readonly executionId: string;
  readonly kind: 'stimulus' | 'inspection' | 'procedure';
  readonly activities: readonly {
    readonly activityId: string;
    readonly purpose: ActivityPurpose;
    readonly traceIds: readonly string[];
  }[];
}

export interface ActivityProvenance {
  readonly sessionId: string;
  readonly executionId: string;
  readonly activityId: string;
  readonly purpose: ActivityPurpose;
  readonly traceId: string;
  readonly spanId: string;
}

export function freezeActivityData<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) {
      freezeActivityData(child);
    }
    Object.freeze(value);
  }
  return value;
}
