import { expect as check } from '@playwright/test';
import { test } from '../../index.js';
import { completeGraph, emission, recordedEffects } from '../../effects/testing/emissions.fixture.js';
import { captureObservedPost } from '../../../tests/effects/support.js';

function captures() {
  const empty = recordedEffects(completeGraph([]));
  const full = recordedEffects(completeGraph([{ ...emission('1'), actor: 'app' }]));
  return { empty, full };
}

test('delayed HTTP observation returns the exact successful cut', async () => {
  const { empty, full } = captures();
  let calls = 0;
  const expected = await full.capture();
  const result = await captureObservedPost({ capture: async () => {
    calls++;
    return calls === 1 ? empty.capture() : expected;
  } }, 1_000);
  check(calls).toBe(2);
  check(result.capture).toBe(expected);
  check(result.http.emissions).toHaveLength(1);
  check(result.http.emissions[0].id).toBe('1');
});

test('missing HTTP observation times out instead of snapshotting empty', async () => {
  const { empty } = captures();
  let calls = 0;
  await check(captureObservedPost({ capture: async () => {
    calls++;
    return empty.capture();
  } }, 350)).rejects.toThrow(/toBeGreaterThan/);
  check(calls).toBeGreaterThan(1);
});
