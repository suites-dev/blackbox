import type { EffectInput } from '../model/input.js';

/** Minimal OTLP/HTTP JSON builders for hand-written test inputs. */
export interface SpanSpec {
  readonly traceId: string;
  readonly spanId: string;
  readonly name: string;
  readonly kind: number;
  readonly attributes: readonly { readonly key: string; readonly value: unknown }[];
}

export function span(spec: SpanSpec): Record<string, unknown> {
  return {
    traceId: spec.traceId,
    spanId: spec.spanId,
    name: spec.name,
    kind: spec.kind,
    startTimeUnixNano: '1750000000000000000',
    endTimeUnixNano: '1750000000001000000',
    attributes: spec.attributes,
    status: { code: 0 },
  };
}

export function request(
  service: string,
  spans: readonly Record<string, unknown>[],
  scope = 'test-scope',
): Record<string, unknown> {
  return {
    resourceSpans: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: service } }] },
        scopeSpans: [{ scope: { name: scope, version: '1.0.0' }, spans }],
      },
    ],
  };
}

export function effectInput(
  fragments: readonly { readonly sequence: number; readonly request: unknown }[],
): EffectInput {
  return {
    scope: { kind: 'capsule-session', sessionId: 'test-session' },
    sources: [
      {
        kind: 'otlp-json-fragments',
        fragments: fragments.map((fragment) => ({
          sequence: fragment.sequence,
          rawJson: JSON.stringify(fragment.request),
        })),
      },
    ],
  };
}

export const traceA = '0af7651916cd43dd8448eb211c80319c';
export const traceB = '4bf92f3577b34da6a3ce929d0e0e4736';
