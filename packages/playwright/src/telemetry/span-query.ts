import { setTimeout as delay } from 'node:timers/promises';

import type { AttemptTelemetry } from '../runtime/telemetry-handle.js';
import type {
  BlackboxSpan,
  BlackboxSpanQuery,
  BlackboxSpanWaitOptions,
  BlackboxTelemetry,
} from '../types.js';
import { decodeSpans } from './otlp-spans.js';

const defaultWait = { timeoutMs: 10_000, intervalMs: 250 } satisfies BlackboxSpanWaitOptions;

function matches(span: BlackboxSpan, query: BlackboxSpanQuery): boolean {
  const name = query.name;
  return (
    (query.traceId === undefined || span.traceId === query.traceId) &&
    (query.service === undefined || span.service === query.service) &&
    (query.kind === undefined || span.kind === query.kind) &&
    (name === undefined || (typeof name === 'string' ? span.name === name : name.test(span.name)))
  );
}

async function retainedSpans(
  telemetry: AttemptTelemetry,
  traceId: string | undefined,
): Promise<readonly BlackboxSpan[]> {
  let traceIds: readonly string[] = traceId === undefined ? [] : [traceId];
  if (traceId === undefined) {
    const session = await telemetry.read();
    if (session.kind === 'collector-session-corrupt') {
      throw new Error(`Blackbox telemetry is corrupt: ${session.error.message}`);
    }
    // Nothing is retained until the collector receives its first span.
    traceIds = session.kind === 'collector-session-found' ? session.traceIds : [];
  }
  const spans: BlackboxSpan[] = [];
  for (const id of traceIds) {
    const trace = await telemetry.readTrace(id);
    if (trace.kind === 'collector-trace-corrupt') {
      throw new Error(`Blackbox trace ${id} is corrupt: ${trace.error.message}`);
    }
    if (trace.kind === 'collector-trace-found') {
      spans.push(...decodeSpans(trace.fragments));
    }
  }
  return spans;
}

function describe(query: BlackboxSpanQuery): string {
  return JSON.stringify(query, (_key, value: unknown) =>
    value instanceof RegExp ? String(value) : value,
  );
}

function seen(spans: readonly BlackboxSpan[]): string {
  const shown = spans
    .slice(0, 20)
    .map((span) => `${span.service ?? '?'} ${span.kind} ${span.name}`);
  const more = spans.length > shown.length ? `; ${spans.length - shown.length} more` : '';
  return shown.length === 0 ? 'no spans retained' : `${shown.join('; ')}${more}`;
}

/** Span queries over this attempt's retained telemetry. */
export function spanQueries(
  telemetry: AttemptTelemetry,
): Pick<BlackboxTelemetry, 'spans' | 'waitForSpan'> {
  const spans = async (query: BlackboxSpanQuery = {}) =>
    (await retainedSpans(telemetry, query.traceId)).filter((span) => matches(span, query));
  return {
    spans,
    async waitForSpan(query, options = {}) {
      const { timeoutMs, intervalMs } = { ...defaultWait, ...options };
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const all = await retainedSpans(telemetry, query.traceId);
        const found = all.find((span) => matches(span, query));
        if (found !== undefined) {
          return found;
        }
        if (Date.now() >= deadline) {
          throw new Error(
            `No span matched ${describe(query)} within ${timeoutMs}ms; retained: ${seen(all)}`,
          );
        }
        await delay(intervalMs);
      }
    },
  };
}
