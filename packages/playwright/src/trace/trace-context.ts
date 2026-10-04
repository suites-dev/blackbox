import { randomBytes } from 'node:crypto';

/** W3C trace context for one activity started by the fixture. */
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

/** A fresh sampled trace with a synthetic parent span, as `capsule run` creates per activity. */
export function createAttemptTraceContext(random: RandomBytes = randomBytes): AttemptTraceContext {
  const traceId = nonZeroHex(16, random);
  const parentId = nonZeroHex(8, random);
  return Object.freeze({ traceId, traceparent: `00-${traceId}-${parentId}-01` });
}
