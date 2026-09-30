import type { APIRequestContext, APIResponse } from '@playwright/test';
import { expect } from '@suites/blackbox-playwright';

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export const blackboxEnvironment = {
  FIXTURE_CONTROL_TOKEN: requiredEnvironment('BLACKBOX_E2E_FIXTURE_TOKEN'),
};

export async function expectJson<T>(response: APIResponse, status: number): Promise<T> {
  expect(response.status()).toBe(status);
  expect(response.headers()['content-type']).toContain('application/json');
  return (await response.json()) as T;
}

export async function readFixtureState<T>(request: APIRequestContext): Promise<T> {
  const response = await request.get('/fixture/state', {
    headers: { authorization: `Bearer ${blackboxEnvironment.FIXTURE_CONTROL_TOKEN}` },
  });
  return expectJson<T>(response, 200);
}
