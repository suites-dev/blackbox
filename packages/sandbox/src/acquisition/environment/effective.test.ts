import { expect, it, vi } from 'vitest';

import type { ComposeStartRequest } from '../../types.js';
import { inspectEffectiveParticipantEnvironmentsWithPorts } from './effective.js';

function request(): ComposeStartRequest {
  return {
    observation: { kind: 'silent' },
    projectDirectory: '/project',
    composeFiles: ['compose.yaml'],
    projectName: 'bb-sandbox-1',
    environment: { PROJECT_VALUE: 'value' },
    serviceSelection: { kind: 'selected', services: ['api'] },
    startupTimeoutMs: 120_000,
    endpoints: [],
    generatedComposeDirectory: '/project/.blackbox/generated',
    telemetry: {
      kind: 'enabled',
      sessionId: 'session-1',
      executionId: 'execution-1',
      authorization: {
        kind: 'split-bearer-tokens',
        ingestToken: 'ingest-token',
        controlToken: 'control-token',
      },
      collector: {
        service: 'collector',
        containerPort: 4318,
        runtime: { kind: 'image-default', image: 'collector:test' },
        environment: {},
        readiness: {
          kind: 'http',
          path: '/ready',
          intervalSeconds: 1,
          timeoutSeconds: 1,
          retries: 10,
        },
        drain: { kind: 'signal', signal: 'SIGTERM' },
      },
      participants: [
        {
          service: 'api',
          runtime: 'node',
          environment: {},
          activation: {
            kind: 'append-environment-variable',
            name: 'NODE_OPTIONS',
            value: '--require=/blackbox/instrumentation.js',
          },
          mounts: [],
        },
      ],
    },
  };
}

it('creates without starting, inspects the exact participant environment, and tears down', async () => {
  const createMany = vi.fn(() => Promise.resolve());
  const down = vi.fn(() => Promise.resolve());
  const result = await inspectEffectiveParticipantEnvironmentsWithPorts({
    request: request(),
    compose: { createMany, down },
    containers: {
      listCreated: () => Promise.resolve([{ id: 'container-1', service: 'api' }]),
      environment: () =>
        Promise.resolve({ NODE_OPTIONS: '--enable-source-maps', IMAGE_VALUE: 'retained' }),
    },
  });
  expect(result.get('api')).toEqual({
    NODE_OPTIONS: '--enable-source-maps',
    IMAGE_VALUE: 'retained',
  });
  expect(createMany).toHaveBeenCalledWith(
    ['api'],
    expect.objectContaining({
      cwd: '/project',
      config: ['compose.yaml'],
      composeOptions: ['--project-name', 'bb-sandbox-1'],
      commandOptions: ['--build'],
    }),
  );
  expect(down).toHaveBeenCalledWith(
    expect.objectContaining({ commandOptions: ['--volumes', '--remove-orphans'] }),
  );
});

it('tears the preflight down when a selected participant was not created', async () => {
  const down = vi.fn(() => Promise.resolve());
  await expect(
    inspectEffectiveParticipantEnvironmentsWithPorts({
      request: request(),
      compose: { createMany: () => Promise.resolve(), down },
      containers: {
        listCreated: () => Promise.resolve([]),
        environment: () => Promise.resolve({}),
      },
    }),
  ).rejects.toThrow('did not create telemetry participant');
  expect(down).toHaveBeenCalledOnce();
});
