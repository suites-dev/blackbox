import type { EffectInput } from '../model/input.js';

/**
 * A small seeded generator for property tests. mulberry32 is a public-domain
 * 32-bit PRNG: the same seed always yields the same sequence on every platform.
 */
export type Random = () => number;

export function mulberry32(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(random: Random, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)];
}

export function shuffle<T>(random: Random, values: readonly T[]): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function hex(random: Random, length: number): string {
  let text = '';
  while (text.length < length) {
    text += Math.floor(random() * 16).toString(16);
  }
  return text.replace(/^0/u, '1');
}

/** One generated span with the resource and scope it is exported under. */
export interface GeneratedSpan {
  readonly service: string;
  readonly scope: string;
  readonly span: Readonly<Record<string, unknown>>;
}

const SERVICES = ['api', 'worker', 'billing'] as const;
const SCOPES = ['scope-a', 'scope-b'] as const;
const NAMES = ['GET', 'POST', 'pg.query:INSERT', 'redis-SET', 'orders send'] as const;

function attributes(random: Random): readonly Record<string, unknown>[] {
  const status = pick(random, [200, 201, 503]);
  return [
    {
      key: 'http.response.status_code',
      value: pick(random, [{ intValue: status }, { intValue: String(status) }]),
    },
    { key: 'net.peer.port', value: { intValue: 50_910 } },
    { key: 'flag', value: { boolValue: random() < 0.5 } },
  ];
}

/** Spans with unique ids spread over a few traces, services, and scopes. */
export function generateSpans(random: Random, count: number): readonly GeneratedSpan[] {
  const traces = [hex(random, 32), hex(random, 32), hex(random, 32)];
  const spanIds = new Set<string>();
  while (spanIds.size < count) {
    spanIds.add(hex(random, 16));
  }
  return [...spanIds].map((spanId) => ({
    service: pick(random, SERVICES),
    scope: pick(random, SCOPES),
    span: {
      traceId: pick(random, traces),
      spanId,
      name: pick(random, NAMES),
      kind: 1 + Math.floor(random() * 5),
      startTimeUnixNano: '1750000000000000000',
      endTimeUnixNano: '1750000000001000000',
      attributes: attributes(random),
    },
  }));
}

/** Build one OTLP request, grouping spans by service then scope in first-seen order. */
export function otlpRequest(spans: readonly GeneratedSpan[]): Record<string, unknown> {
  const resources = new Map<string, Map<string, unknown[]>>();
  for (const { service, scope, span } of spans) {
    const scopes = resources.get(service) ?? new Map<string, unknown[]>();
    resources.set(service, scopes);
    scopes.set(scope, [...(scopes.get(scope) ?? []), span]);
  }
  return {
    resourceSpans: [...resources].map(([service, scopes]) => ({
      resource: { attributes: [{ key: 'service.name', value: { stringValue: service } }] },
      scopeSpans: [...scopes].map(([name, scopeSpans]) => ({ scope: { name }, spans: scopeSpans })),
    })),
  };
}

/** Fragments in the given array order; each keeps its own sequence number. */
export function generatedInput(
  fragments: readonly { readonly sequence: number; readonly spans: readonly GeneratedSpan[] }[],
): EffectInput {
  return {
    scope: { kind: 'capsule-session', sessionId: 'property-session' },
    sources: [
      {
        kind: 'otlp-json-fragments',
        fragments: fragments.map(({ sequence, spans }) => ({
          sequence,
          rawJson: JSON.stringify(otlpRequest(spans)),
        })),
      },
    ],
  };
}

/** Split spans into `parts` fragments by a seeded assignment (some may be empty). */
export function partition<T>(random: Random, values: readonly T[], parts: number): T[][] {
  const result = Array.from({ length: parts }, (): T[] => []);
  for (const value of values) {
    result[Math.floor(random() * parts)].push(value);
  }
  return result;
}
