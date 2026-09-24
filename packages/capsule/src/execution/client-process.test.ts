import { once } from 'node:events';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import type { ResolvedCatalogClient } from '@suites/blackbox-catalog-internal';
import type { SandboxHandle, SandboxTelemetryStatus } from '@suites/blackbox-sandbox-internal';
import { afterEach, expect, it } from 'vitest';

import { runCapsuleClient } from './client-process.js';

const roots: string[] = [];
const servers: Server[] = [];
const require = createRequire(import.meta.url);
const clientPackage = resolve(dirname(require.resolve('@suites/blackbox-client')), '..');

async function projectFixture(input: {
  readonly kind: 'entrypoint' | 'utility';
}): Promise<string> {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'capsule-client-'));
  roots.push(projectDirectory);
  await mkdir(join(projectDirectory, 'node_modules/@suites'), { recursive: true });
  await symlink(
    clientPackage,
    join(projectDirectory, 'node_modules/@suites/blackbox-client'),
    'dir',
  );
  await mkdir(join(projectDirectory, '.blackbox/instrumentation'), { recursive: true });
  await writeFile(join(projectDirectory, '.blackbox/instrumentation/instrumentation.js'), '');
  await writeFile(
    join(projectDirectory, 'client.mjs'),
    [
      `export default { kind: ${JSON.stringify(input.kind)}, name: 'orders-client',`,
      '  run(input) {',
      "    return { kind: 'json', value: { args: input.args, target: input.target, telemetry: input.telemetry } };",
      '  }',
      '};',
    ].join('\n'),
  );
  return projectDirectory;
}

function client(kind: 'entrypoint' | 'participant'): ResolvedCatalogClient {
  return {
    id: 'orders-client',
    ref: 'client.mjs',
    target: {
      kind,
      participantId: 'api',
      service: 'api-service',
      protocol: 'http',
      containerPort: 3000,
    },
  };
}

function sandbox(input: {
  readonly inspect: () => Promise<SandboxTelemetryStatus>;
}): SandboxHandle {
  return {
    sandboxId: 'sandbox-1',
    projectName: 'project-1',
    state: 'running',
    declaredEnvironment: {},
    endpoints: new Map([
      [
        'client-orders-client',
        {
          name: 'client-orders-client',
          service: 'api-service',
          host: '127.0.0.1',
          port: 49152,
          containerPort: 3000,
        },
      ],
    ]),
    containers: new Map(),
    telemetry: { kind: 'disabled' },
    inspectTelemetry: input.inspect,
    getContainer: () => {
      throw new Error('unused');
    },
    inspectResources: () => {
      throw new Error('unused');
    },
    execute: () => {
      throw new Error('unused');
    },
    stop: () => {
      throw new Error('unused');
    },
  };
}

function runInput(input: {
  readonly projectDirectory: string;
  readonly client: ResolvedCatalogClient;
  readonly sandbox: SandboxHandle;
}) {
  return {
    ...input,
    sessionId: 'quiet-river-ada',
    executionId: 'execution-1',
    activityId: 'activity-1',
    args: ['alice', '--literal=$(safe)'],
    authorization: { kind: 'bearer-token' as const, token: 'secret-token' },
  };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async (server) => {
      server.closeAllConnections();
      await new Promise<void>((complete) => {
        server.close(() => {
          complete();
        });
      });
    }),
  );
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('runs a utility client without consulting telemetry and exposes only the resolved target', async () => {
  const projectDirectory = await projectFixture({ kind: 'utility' });
  let inspections = 0;
  const result = await runCapsuleClient(
    runInput({
      projectDirectory,
      client: client('participant'),
      sandbox: sandbox({
        inspect: () => {
          inspections += 1;
          return Promise.resolve({ kind: 'unavailable', endpoints: telemetryEndpoints, error: down });
        },
      }),
    }),
  );
  expect(inspections).toBe(0);
  expect(result).toMatchObject({
    kind: 'client-completed',
    client: { behavior: 'utility', name: 'orders-client' },
    telemetry: { kind: 'not-requested' },
    result: {
      kind: 'json',
      value: {
        args: ['alice', '--literal=$(safe)'],
        telemetry: { kind: 'disabled' },
        target: {
          kind: 'participant',
          endpoint: { host: '127.0.0.1', port: 49152, url: 'http://127.0.0.1:49152' },
          environment: {
            BLACKBOX_CLIENT_HOST: '127.0.0.1',
            BLACKBOX_CLIENT_PORT: '49152',
          },
        },
      },
    },
  });
});

it('rejects an authored name that does not match the catalog client ID', async () => {
  const projectDirectory = await projectFixture({ kind: 'utility' });
  await writeFile(
    join(projectDirectory, 'client.mjs'),
    "export default { kind: 'utility', name: 'other-client', run: () => ({ kind: 'empty' }) };\n",
  );
  await expect(
    runCapsuleClient(
      runInput({
        projectDirectory,
        client: client('participant'),
        sandbox: sandbox({
          inspect: () => {
            throw new Error('Telemetry must not be inspected before identity validation');
          },
        }),
      }),
    ),
  ).rejects.toThrow('must match catalog ID "orders-client"');
});

const telemetryEndpoints = {
  baseUrl: 'http://127.0.0.1:4318',
  tracesUrl: 'http://127.0.0.1:4318/v1/traces',
  activationUrl: 'http://127.0.0.1:4318/v1/activation',
  readUrl: 'http://127.0.0.1:4318/v1/collector',
};
const down = { name: 'CollectorUnavailable', message: 'collector stopped during execution' };

it('requires the exact activity read before marking entrypoint telemetry complete', async () => {
  const projectDirectory = await projectFixture({ kind: 'entrypoint' });
  const requests: { readonly url: string; readonly authorization: string }[] = [];
  const server = createServer((request, response) => {
    requests.push({
      url: request.url ?? '',
      authorization: request.headers.authorization ?? '',
    });
    response
      .writeHead(404, { 'content-type': 'application/json' })
      .end(JSON.stringify({ kind: 'collector-activity-missing' }));
  });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Collector read fixture did not bind');
  }
  const endpoints = {
    ...telemetryEndpoints,
    readUrl: `http://127.0.0.1:${String(address.port)}/v1/collector`,
  };
  let inspections = 0;
  const result = await runCapsuleClient(
    runInput({
      projectDirectory,
      client: client('entrypoint'),
      sandbox: sandbox({
        inspect: () => {
          inspections += 1;
          return Promise.resolve({ kind: 'available', endpoints });
        },
      }),
    }),
  );
  expect(inspections).toBe(2);
  expect(result).toMatchObject({
    client: { behavior: 'entrypoint' },
    result: {
      kind: 'json',
      value: {
        telemetry: {
          kind: 'enabled',
          sessionId: 'quiet-river-ada',
          executionId: 'execution-1',
          activityId: 'activity-1',
        },
        target: { kind: 'entrypoint', service: 'api-service' },
      },
    },
    telemetry: {
      kind: 'incomplete',
      error: {
        name: 'ClientTelemetryIncomplete',
        message: 'Collector did not retain activity activity-1 (collector-activity-missing).',
      },
    },
  });
  expect(requests).toEqual([
    { url: '/v1/collector/activities/activity-1', authorization: 'Bearer secret-token' },
  ]);
});
