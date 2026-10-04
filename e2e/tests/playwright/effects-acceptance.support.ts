import { expect } from '@suites/blackbox-playwright';

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
