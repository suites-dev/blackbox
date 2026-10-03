import type { Page } from '@playwright/test';
import {
  expect,
  type BlackboxNativeTestArgs,
  type BlackboxNativeWorkerArgs,
  type BlackboxSandboxSuite,
} from '@suites/blackbox-playwright';

export type EffectsSuite = BlackboxSandboxSuite<BlackboxNativeTestArgs, BlackboxNativeWorkerArgs>;

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

export async function insertFromBrowser(
  page: Page,
  entrypointUrl: string,
  id: number,
): Promise<void> {
  await page.goto(new URL(`/browser/records/${id}`, entrypointUrl).href);
  const inserted = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `/records/${id}`,
  );
  await page.getByRole('button', { name: 'Insert record' }).click();
  expect((await inserted).status()).toBe(201);
  await expect(page.locator('#result')).toHaveText('inserted');
}
