import type { ActivityContext, ObservationCompleteness } from '../../investigation/index.js';
import type {
  BuiltTrace,
  CapsuleReportLimitation,
  CapsuleReportUncausedTrace,
  TraceSpans,
  Uncaused,
} from './types.js';

function contextLimitations(context: ActivityContext | null): readonly CapsuleReportLimitation[] {
  if (context === null) {
    return [];
  }
  switch (context.kind) {
    case 'untraced':
      return [{ kind: 'untraced' }];
    case 'not-carried':
      return [{ kind: 'context-not-carried', resource: context.resource }];
    case 'injection-failed':
      return [
        { kind: 'context-injection-failed', carrier: context.carrier, message: context.message },
      ];
    default:
      return [];
  }
}

export function activityLimitations(input: {
  readonly provisional: boolean;
  readonly unknown: readonly Uncaused[];
  readonly context: ActivityContext | null;
  readonly own: BuiltTrace | null;
  readonly ownTrace: TraceSpans | null;
}): readonly CapsuleReportLimitation[] {
  const { own, ownTrace } = input;
  const unavailable =
    own === null && ownTrace !== null && input.context !== null && input.context.kind === 'sent'
      ? ownTrace.unavailable
      : null;
  return [
    ...(input.provisional ? [{ kind: 'observation-provisional' as const }] : []),
    ...input.unknown.map(({ traceId }) => ({ kind: 'causality-unknown' as const, trace: traceId })),
    ...contextLimitations(input.context),
    ...(own === null
      ? []
      : own.orphans.map((spanId) => ({
          kind: 'orphan-span' as const,
          spanId,
          trace: own.caused.traceId,
        }))),
    ...(unavailable === null || ownTrace === null
      ? []
      : [
          {
            kind: 'observation-unavailable' as const,
            trace: ownTrace.traceId,
            reason: unavailable,
          },
        ]),
  ];
}

export function capsuleLimitations(input: {
  readonly completeness: ObservationCompleteness;
  readonly uncaused: readonly CapsuleReportUncausedTrace[];
  readonly unavailable: readonly TraceSpans[];
}): readonly CapsuleReportLimitation[] {
  const { completeness } = input;
  const observation: readonly CapsuleReportLimitation[] =
    completeness.status === 'incomplete'
      ? [{ kind: 'observation-incomplete', reason: completeness.reason }]
      : completeness.status === 'provisional'
        ? [{ kind: 'observation-provisional' }]
        : [];
  return [
    ...observation,
    ...input.uncaused.map(({ trace }) => ({ kind: 'causality-unknown' as const, trace })),
    ...input.unavailable.flatMap((trace) =>
      trace.unavailable === null
        ? []
        : [
            {
              kind: 'observation-unavailable' as const,
              trace: trace.traceId,
              reason: trace.unavailable,
            },
          ],
    ),
  ];
}
