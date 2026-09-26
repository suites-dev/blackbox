import type {
  SandboxHandle,
  SandboxTelemetryStatus,
} from '@suites/blackbox-sandbox-internal';
import { createTelemetryExecutionScope } from '@suites/blackbox-telemetry-internal';
import { afterEach, expect, it, vi } from 'vitest';

import { exportActivityRootSpan } from './root-span.js';

function sandbox(telemetry: SandboxTelemetryStatus): SandboxHandle {
  return {
    sandboxId: 'sandbox',
    projectName: 'project',
    state: 'running',
    declaredEnvironment: {},
    endpoints: new Map(),
    containers: new Map(),
    telemetry,
    getContainer: () => {
      throw new Error('unused');
    },
    inspectResources: () => {
      throw new Error('unused');
    },
    execute: () => {
      throw new Error('unused');
    },
    startContainerExecution: () => {
      throw new Error('unused');
    },
    inspectTelemetry: () => Promise.resolve(telemetry),
    stop: () => {
      throw new Error('unused');
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it('exports the owned root span with an error status for failed execution', async () => {
  const tracesUrl = 'http://collector.test/v1/traces';
  const fetch = vi.fn((...parameters: Parameters<typeof globalThis.fetch>) => {
    const request = parameters[1];
    if (request === undefined) {
      throw new Error('Expected OTLP request options');
    }
    expect(parameters[0]).toBe(tracesUrl);
    if (typeof request.body !== 'string') {
      throw new Error('Expected a JSON string body');
    }
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(request.body)).toMatchObject({
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  name: 'capsule.driver',
                  status: { code: 2, message: 'command failed' },
                },
              ],
            },
          ],
        },
      ],
    });
    return Promise.resolve(new Response('', { status: 200 }));
  });
  vi.stubGlobal('fetch', fetch);
  const scope = createTelemetryExecutionScope({
    executionId: 'activity-1',
    operationName: 'capsule.driver',
  });

  await expect(
    exportActivityRootSpan({
      sandbox: sandbox({
        kind: 'available',
        endpoints: {
          baseUrl: 'http://collector.test',
          tracesUrl,
          activationUrl: 'http://collector.test/activation',
          readUrl: 'http://collector.test/read',
        },
      }),
      authorizationToken: 'token',
      sessionId: 'quiet-river-ada',
      activityId: 'activity-1',
      purpose: 'stimulus',
      scope: scope.active,
      result: { kind: 'telemetry-scope-failed', message: 'command failed' },
    }),
  ).resolves.toEqual({ kind: 'root-span-exported' });
  expect(fetch).toHaveBeenCalledOnce();
});

it('returns an explicit failure when the collector is unavailable', async () => {
  const scope = createTelemetryExecutionScope({
    executionId: 'activity-2',
    operationName: 'capsule.host',
  });
  await expect(
    exportActivityRootSpan({
      sandbox: sandbox({ kind: 'disabled' }),
      authorizationToken: 'token',
      sessionId: 'quiet-river-ada',
      activityId: 'activity-2',
      purpose: 'inspection',
      scope: scope.active,
      result: { kind: 'telemetry-scope-succeeded' },
    }),
  ).resolves.toEqual({
    kind: 'root-span-export-failed',
    message: 'Collector is disabled',
  });
});
