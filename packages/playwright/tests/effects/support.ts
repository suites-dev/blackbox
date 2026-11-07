import { expect, type BlackboxEffects, type EffectCapture, type EffectRecorder } from '@suites/blackbox-playwright';

export async function json<T>(
  response: { status(): number; json(): Promise<unknown> },
  status: number,
): Promise<T> {
  expect(response.status()).toBe(status);
  return (await response.json()) as T;
}

export function traceId(headers: Readonly<Record<string, string>>): string {
  const value = headers.traceparent;
  expect(value).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  return value.split('-')[1];
}

export { effectsGolden } from './golden.js';

/** Retain the same immutable cut whose selected HTTP observation satisfied the poll. */
export async function captureObservedPost(
  effects: Pick<BlackboxEffects, 'capture'>,
  timeoutMs = 5_000,
): Promise<{ readonly capture: EffectCapture; readonly http: EffectRecorder }> {
  const latest: Partial<{ capture: EffectCapture; http: EffectRecorder }> = {};
  await expect.poll(async () => {
    const capture = await effects.capture();
    const http = capture.http({ actor: 'app', method: 'POST' });
    latest.capture = capture;
    latest.http = http;
    return http.emissions.length;
  }, { timeout: timeoutMs }).toBeGreaterThan(0);
  if (latest.capture === undefined || latest.http === undefined) {
    throw new Error('No observed HTTP capture was retained');
  }
  return { capture: latest.capture, http: latest.http };
}
