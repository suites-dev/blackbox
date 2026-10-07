import type {
  CollectorSessionReadResult,
  CollectorTracesReadResult,
} from '@suites/blackbox-otel-collector';

import type { CapsuleActivityReport } from '../../../model/execution/activity.js';
import {
  completedDriverActivity,
  completedHostActivity,
} from '../../../persistence/testing/record.fixture.js';
import type { CapsuleSessionRecord } from '../../../records.js';
import type { CapsuleReportCausality } from '../../causality/types.js';
import { projectCapsuleReport } from '../../document.js';

export const sessionId = 'quiet-river-ada';
export const executionId = '00000000-0000-4000-8000-000000000001';

export const record = {
  schemaVersion: 1,
  sessionId,
  executionId,
  system: 'orders',
  title: 'Orders experiment',
  description: { kind: 'omitted' },
  state: 'stopped',
  revision: 1,
  admittedAt: '2026-09-24T10:00:00.000Z',
  updatedAt: '2026-09-24T10:01:00.000Z',
  manager: { kind: 'not-started' },
  socketPath: '/private/manager.sock',
  entrypoint: { kind: 'unavailable' },
  containers: [],
  cleanup: { kind: 'complete' },
  failure: { kind: 'none' },
  composeProject: { kind: 'unavailable' },
  artifactRoot: '/private/artifacts',
  networks: [],
  volumes: [],
  readiness: { kind: 'unavailable' },
} satisfies CapsuleSessionRecord;

export const CAUSED_TRACE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
export const UNLINKED_TRACE = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
export const ACTIVITY_START = '2026-09-24T10:00:10.000Z';

const sentPropagation = {
  schemaVersion: 1,
  kind: 'telemetry-propagation-v1',
  expectation: { kind: 'w3c-trace-context-propagation', carrier: 'http-headers' },
  outcome: { kind: 'context-injected', format: 'w3c-trace-context', carrier: 'http-headers' },
} as const;

type Completed = Extract<CapsuleActivityReport, { readonly kind: 'completed' }>;

/** A completed host activity whose context trace is `traceId`; `propagation` replaces its outcome's. */
export function activity(
  input: {
    readonly activityId: string;
    readonly sequence: number;
    readonly traceId: string;
  } & Partial<{
    readonly spanId: string;
    readonly startedAt: string;
    readonly completedAt: string;
    readonly purpose: Completed['purpose'];
    readonly propagation: 'sent' | 'raw';
  }>,
): Completed {
  const base = completedHostActivity();
  const spanId = input.spanId ?? 'cccccccccccccccc';
  const outcome =
    input.propagation === 'sent' && base.outcome.kind === 'exited'
      ? { ...base.outcome, propagation: sentPropagation }
      : base.outcome;
  return {
    ...base,
    activityId: input.activityId,
    sequence: input.sequence,
    purpose: input.purpose ?? 'stimulus',
    startedAt: input.startedAt ?? ACTIVITY_START,
    completedAt: input.completedAt ?? '2026-09-24T10:00:12.000Z',
    telemetry: {
      ...base.telemetry,
      executionId: input.activityId,
      startedAt: input.startedAt ?? ACTIVITY_START,
      context: {
        ...base.telemetry.context,
        traceId: input.traceId,
        spanId,
        traceparent: `00-${input.traceId}-${spanId}-01`,
      },
    },
    outcome,
  };
}

export { completedDriverActivity };

export type SpanInput = {
  readonly traceId: string;
  readonly spanId: string;
  readonly name: string;
  readonly service: string;
  readonly start: string;
} & Partial<{
  readonly parentSpanId: string;
  readonly kind: number;
  readonly attributes: readonly (readonly [string, string])[];
}>;

/** Collector trace fragments holding these spans, grouped by trace. */
export function traces(spans: readonly SpanInput[]): CollectorTracesReadResult {
  const ids = [...new Set(spans.map((span) => span.traceId))];
  return {
    kind: 'collector-traces-found',
    identity: { sessionId, executionId },
    traces: ids.map((traceId, index) => ({
      traceId,
      fragments: [
        {
          sequence: index + 1,
          receivedAt: '2026-09-24T10:00:20.000Z',
          request: {
            resourceSpans: spans
              .filter((span) => span.traceId === traceId)
              .map((span) => ({
                resource: {
                  attributes: [{ key: 'service.name', value: { stringValue: span.service } }],
                },
                scopeSpans: [
                  {
                    spans: [
                      {
                        traceId: span.traceId,
                        spanId: span.spanId,
                        parentSpanId: span.parentSpanId ?? '',
                        name: span.name,
                        kind: span.kind ?? 2,
                        startTimeUnixNano: String(BigInt(Date.parse(span.start)) * 1_000_000n),
                        attributes: (span.attributes ?? []).map(([key, value]) => ({
                          key,
                          value: { stringValue: value },
                        })),
                      },
                    ],
                  },
                ],
              })),
          },
        },
      ],
    })),
  };
}

type Lifecycle = Extract<
  CollectorSessionReadResult,
  { readonly kind: 'collector-session-found' }
>['lifecycle'];
type Run = Lifecycle['runs'][number];

const endpoint = {
  kind: 'http',
  host: '127.0.0.1',
  port: 4318,
  baseUrl: 'http://127.0.0.1:4318',
  tracesPath: '/v1/traces',
  tracesUrl: 'http://127.0.0.1:4318/v1/traces',
  activationPath: '/v1/activation',
  activationUrl: 'http://127.0.0.1:4318/v1/activation',
  readinessPath: '/ready',
  readinessUrl: 'http://127.0.0.1:4318/ready',
  readPath: '/v1/collector',
  readUrl: 'http://127.0.0.1:4318/v1/collector',
} as const;

export function run(overrides: Partial<Run> = {}): Run {
  return {
    instanceId: 'collector-1',
    startedAt: '2026-09-24T10:00:00.000Z',
    updatedAt: '2026-09-24T10:01:00.000Z',
    stoppedAt: '2026-09-24T10:01:00.000Z',
    receiver: 'stopped',
    instrumentation: { kind: 'not-activated' },
    shutdown: 'complete',
    failure: null,
    endpoint,
    ...overrides,
  };
}

export function session(
  traceIds: readonly string[],
  runs: readonly Run[] = [run()],
): CollectorSessionReadResult {
  return {
    kind: 'collector-session-found',
    lifecycle: {
      schemaVersion: 1,
      sessionId,
      executionId,
      revision: 3,
      runs,
      telemetry: {
        status: 'received',
        acceptedRequests: 1,
        acceptedSpans: 1,
        lastReceivedAt: '2026-09-24T10:00:30.000Z',
      },
    },
    fragments: [],
    traceIds,
  };
}

export function report(
  input: {
    readonly activities: readonly CapsuleActivityReport[];
    readonly observations: CollectorSessionReadResult;
  } & Partial<{
    readonly traceObservations: CollectorTracesReadResult;
    readonly state: CapsuleSessionRecord['state'];
  }>,
) {
  return projectCapsuleReport({
    generatedAt: '2026-09-24T10:05:00.000Z',
    record: { ...record, state: input.state ?? 'stopped' },
    activities: input.activities,
    progress: [],
    activityObservations: [],
    observations: input.observations,
    traceObservations: input.traceObservations ?? traces([]),
  });
}

/** The one item of a list the test expects to be non-empty. */
export function first<T>(items: readonly T[]): T {
  const [item] = items;
  if (item === undefined) {
    throw new Error('expected at least one item');
  }
  return item;
}

/** What `show` calls the reason: present only when the observations are incomplete. */
export function reasonOf(document: CapsuleReportCausality): string | null {
  return document.status === 'incomplete' ? document.reason : null;
}
