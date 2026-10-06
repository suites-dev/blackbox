import type { APIRequestContext } from '@playwright/test';
import { expect } from '@suites/blackbox-playwright';

// This endpoint and credential are provided by the example application, not Blackbox.
export function fixtureEnvironment(): Record<string, string> {
  const token = process.env.BLACKBOX_E2E_FIXTURE_TOKEN;
  if (!token) throw new Error('BLACKBOX_E2E_FIXTURE_TOKEN is required');
  return { FIXTURE_CONTROL_TOKEN: token };
}

export interface Subscription {
  userId: string;
  status: string;
}

export async function readFixtureState(
  request: APIRequestContext,
  entrypoint: string,
): Promise<{ subscriptions: Subscription[] }> {
  const token = fixtureEnvironment().FIXTURE_CONTROL_TOKEN;
  const response = await request.get(new URL('/fixture/state', entrypoint).href, {
    headers: { authorization: `Bearer ${token}` },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(200);
  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null || !('subscriptions' in body)) {
    throw new Error('Fixture state must contain subscriptions');
  }
  const rows: unknown = body.subscriptions;
  if (!Array.isArray(rows)) throw new Error('subscriptions must be an array');
  const subscriptions = rows.map((row: unknown): Subscription => {
    if (typeof row !== 'object' || row === null ||
        !('userId' in row) || typeof row.userId !== 'string' ||
        !('status' in row) || typeof row.status !== 'string') {
      throw new Error('Invalid subscription state record');
    }
    return { userId: row.userId, status: row.status };
  });
  return { subscriptions };
}
