import type { TestStepInfo } from '@playwright/test';
import { expect, it } from 'vitest';

import { createAttemptEffects } from '../effects/attempt-effects.js';
import { compileEffectContract } from '../effects/contract.js';
import { closeBlackboxEffects, evaluateBlackboxEffects } from '../effects/runtime.js';
import type { RunningBlackboxAttempt } from '../runtime/acquisition.js';
import { createAttemptStep, currentStepContext } from './step-context.js';
import type { BlackboxNativeStep } from './types.js';

function activeContext(): NonNullable<ReturnType<typeof currentStepContext>> {
  const value = currentStepContext();
  if (value === undefined) {
    throw new Error('Expected an active Blackbox step context');
  }
  return value;
}

it('keeps ordinary steps out of effect selection and gives stimulus steps owned propagation', async () => {
  const effects = createAttemptEffects({
    sessionId: 'session-1',
    executionId: 'attempt-1',
    storageDirectory: '/missing-blackbox-step-test',
    entrypointUrl: 'http://127.0.0.1:3000',
  }).effects;
  const attempt = {
    effects,
    sandbox: { executionId: 'attempt-1' },
    telemetry: { sessionId: 'session-1' },
  } as RunningBlackboxAttempt;
  const titles: string[] = [];
  const nativeStep: BlackboxNativeStep = async (title, body) => {
    titles.push(title);
    return body({} as TestStepInfo);
  };
  const fixture = createAttemptStep(nativeStep, attempt);
  try {
    await fixture.step('seed state', () => {
      expect(activeContext().title).toBe('seed state');
    });
    const contract = compileEffectContract((e) => [e.exists(e.http())]);
    await expect(evaluateBlackboxEffects(effects, contract)).resolves.toMatchObject({
      kind: 'inconclusive',
      message: expect.stringContaining('No completed stimulus'),
    });

    const traceparent = await fixture.step.stimulus('send request', async ({ headers }) => {
      expect(headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/u);
      expect(activeContext().traceId).toBe(headers.traceparent.split('-')[1]);
      await fixture.step('check response', () => {
        expect(activeContext().traceId).toBe(headers.traceparent.split('-')[1]);
        expect(activeContext().parent.kind).toBe('child');
      });
      return headers.traceparent;
    });
    expect(traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/u);
    expect(titles).toEqual(['seed state', 'send request', 'check response']);
  } finally {
    fixture.revoke();
    closeBlackboxEffects(effects);
  }
  await expect(fixture.step.stimulus('expired', () => undefined)).rejects.toThrow(
    'no longer active',
  );
});
