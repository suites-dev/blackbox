import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

import type { RunningBlackboxAttempt } from '../runtime/acquisition.js';
import type { BlackboxStep } from './types.js';

interface StepContext {
  readonly executionId: string;
  readonly sessionId: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly parent: { readonly kind: 'root' } | { readonly kind: 'child'; readonly spanId: string };
  readonly title: string;
}
const context = new AsyncLocalStorage<StepContext>();
/** Internal integration point; arbitrary SDKs do not automatically propagate this context. */
export function currentStepContext(): StepContext | undefined {
  return context.getStore();
}
export function createAttemptStep(
  nativeStep: BlackboxStep,
  attempt: RunningBlackboxAttempt,
): {
  readonly step: BlackboxStep;
  revoke(): void;
} {
  let active = true;
  const step: BlackboxStep = (title, body, options) => {
    if (!active) {
      return Promise.reject(new Error('Blackbox step fixture is no longer active'));
    }
    const parent = context.getStore();
    const belongs = parent !== undefined && parent.executionId === attempt.sandbox.executionId;
    const span = Object.freeze({
      executionId: attempt.sandbox.executionId,
      sessionId: attempt.telemetry.sessionId,
      traceId: belongs ? parent.traceId : randomBytes(16).toString('hex'),
      spanId: randomBytes(8).toString('hex'),
      parent: belongs
        ? { kind: 'child' as const, spanId: parent.spanId }
        : { kind: 'root' as const },
      title,
    });
    return nativeStep(title, (info) => context.run(span, () => body(info)), options);
  };
  return {
    step,
    revoke: () => {
      active = false;
    },
  };
}
