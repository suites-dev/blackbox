import type { APIRequestContext, APIResponse } from '@playwright/test';
import {
  expect,
  type BlackboxEffects,
  type BlackboxSandbox,
  type BlackboxTelemetry,
} from '@suites/blackbox-playwright';

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
  const response = await request.get('/fixture/state');
  return expectJson<T>(response, 200);
}

export function expectAttemptEvidenceIdentity(input: {
  readonly effects: BlackboxEffects;
  readonly sandbox: BlackboxSandbox;
  readonly telemetry: BlackboxTelemetry;
}): void {
  expect(input.effects.executionId).toBe(input.sandbox.executionId);
  expect(input.effects.executionId).toBe(input.telemetry.executionId);
  expect(input.effects.sessionId).toBe(input.telemetry.sessionId);
}
