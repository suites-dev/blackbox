import { randomBytes } from 'node:crypto';

/** W3C trace context that the `request` fixture propagates for one test attempt. */
export interface AttemptTraceContext {
  readonly traceId: string;
  readonly traceparent: string;
}

type RandomBytes = (size: number) => Buffer;

/** W3C forbids all-zero trace and parent IDs. */
function nonZeroHex(size: number, random: RandomBytes): string {
  for (;;) {
    const value = random(size).toString('hex');
    if (!/^0+$/u.test(value)) {
      return value;
    }
  }
}

/**
 * One trace per attempt: every `request` call is a child of the same synthetic
 * parent, so all server spans the test causes share the attempt's trace ID.
 */
export function createAttemptTraceContext(random: RandomBytes = randomBytes): AttemptTraceContext {
  const traceId = nonZeroHex(16, random);
  const parentId = nonZeroHex(8, random);
  return Object.freeze({ traceId, traceparent: `00-${traceId}-${parentId}-01` });
}

/** Add traceparent unless the configured headers already carry one. */
export function tracedHeaders(
  configured: Readonly<Record<string, string>> | undefined,
  trace: AttemptTraceContext,
): Readonly<Record<string, string>> {
  const headers = configured ?? {};
  return Object.keys(headers).some((name) => name.toLowerCase() === 'traceparent')
    ? headers
    : { ...headers, traceparent: trace.traceparent };
}
