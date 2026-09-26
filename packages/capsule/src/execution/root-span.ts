import type { SandboxHandle } from '@suites/blackbox-sandbox-internal';
import type {
  ActiveTelemetryExecutionScopeRecord,
  TelemetryScopeResult,
} from '@suites/blackbox-telemetry-internal';

import type { CapsuleActivityPurpose } from './types.js';

export type RootSpanExportResult =
  | { readonly kind: 'root-span-exported' }
  | { readonly kind: 'root-span-export-failed'; readonly message: string };

function unixNanos(iso: string): string {
  return (BigInt(Date.parse(iso)) * 1_000_000n).toString();
}

function request(input: {
  readonly sessionId: string;
  readonly activityId: string;
  readonly purpose: CapsuleActivityPurpose;
  readonly scope: ActiveTelemetryExecutionScopeRecord;
  readonly endedAt: string;
  readonly result: TelemetryScopeResult;
}): Record<string, unknown> {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'blackbox-capsule' } },
            { key: 'blackbox.session.id', value: { stringValue: input.sessionId } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: '@suites/blackbox-capsule', version: '1' },
            spans: [
              {
                traceId: input.scope.context.traceId,
                spanId: input.scope.context.spanId,
                name: input.scope.operationName,
                kind: 1,
                startTimeUnixNano: unixNanos(input.scope.startedAt),
                endTimeUnixNano: unixNanos(input.endedAt),
                attributes: [
                  {
                    key: 'blackbox.activity.id',
                    value: { stringValue: input.activityId },
                  },
                  {
                    key: 'blackbox.activity.purpose',
                    value: { stringValue: input.purpose },
                  },
                ],
                droppedAttributesCount: 0,
                events: [],
                links: [],
                status:
                  input.result.kind === 'telemetry-scope-succeeded'
                    ? { code: 1 }
                    : {
                        code: 2,
                        message:
                          input.result.kind === 'telemetry-scope-failed'
                            ? input.result.message
                            : input.result.reason,
                      },
              },
            ],
          },
        ],
      },
    ],
  };
}

export async function exportActivityRootSpan(input: {
  readonly sandbox: SandboxHandle;
  readonly authorizationToken: string;
  readonly sessionId: string;
  readonly activityId: string;
  readonly purpose: CapsuleActivityPurpose;
  readonly scope: ActiveTelemetryExecutionScopeRecord;
  readonly result: TelemetryScopeResult;
}): Promise<RootSpanExportResult> {
  try {
    const telemetry = await input.sandbox.inspectTelemetry();
    if (telemetry.kind !== 'available') {
      return { kind: 'root-span-export-failed', message: `Collector is ${telemetry.kind}` };
    }
    const response = await fetch(telemetry.endpoints.tracesUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(5_000),
      headers: {
        authorization: `Bearer ${input.authorizationToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(request({ ...input, endedAt: new Date().toISOString() })),
    });
    return response.ok
      ? { kind: 'root-span-exported' }
      : {
          kind: 'root-span-export-failed',
          message: `Collector rejected the activity root span with HTTP ${response.status}`,
        };
  } catch (error) {
    return {
      kind: 'root-span-export-failed',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
