import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

import { runEffectStimulus } from '../effects/attempt-effects.js';
import type { RunningBlackboxAttempt } from '../runtime/acquisition.js';
import type { BlackboxNativeStep, BlackboxStep } from './types.js';

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
  nativeStep: BlackboxNativeStep,
  attempt: RunningBlackboxAttempt,
): {
  readonly step: BlackboxStep;
  revoke(): void;
} {
  let active = true;
  const step = (<T>(title: string, body: Parameters<BlackboxStep>[1], options?: Parameters<BlackboxStep>[2]): Promise<T> => {
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
    return nativeStep(title, (info) => context.run(span, () => body(info)), options) as Promise<T>;
  }) as BlackboxStep;
  step.stimulus = (title, body, options) => {
    if (!active) {
      return Promise.reject(new Error('Blackbox step fixture is no longer active'));
    }
    return nativeStep(
      title,
      (info) => runEffectStimulus(attempt.effects, title, (scope) => {
        const traceparent = scope.headers.traceparent;
        const parts = traceparent.split('-');
        if (parts.length !== 4) {
          throw new Error('Blackbox stimulus did not produce a valid traceparent');
        }
        const span = Object.freeze({
          executionId: attempt.sandbox.executionId,
          sessionId: attempt.telemetry.sessionId,
          traceId: parts[1],
          spanId: parts[2],
          parent: { kind: 'root' as const },
          title,
        });
        return context.run(span, () => body(scope, info));
      }),
      options,
    );
  };
  return {
    step,
    revoke: () => {
      active = false;
    },
  };
}
