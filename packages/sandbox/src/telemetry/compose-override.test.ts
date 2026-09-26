import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { SandboxTelemetryEnabledInput } from '../types.js';
import { writeTelemetryComposeOverride } from './compose-override.js';
import { collectorEnvironment, participantEnvironment } from './environment.js';
import { sandboxTelemetryStorageDirectory } from './storage.js';

async function telemetryFixture(): Promise<{
  readonly telemetry: SandboxTelemetryEnabledInput;
  readonly directory: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-telemetry-override-'));
  const bundle = join(directory, 'instrumentation.js');
  await writeFile(bundle, 'export {}\n');
  return {
    directory,
    telemetry: {
      kind: 'enabled',
      sessionId: 'steady-harbor-alex',
      executionId: 'client-01',
      authorization: {
        kind: 'split-bearer-tokens',
        ingestToken: 'private-ingest-token',
        controlToken: 'private-control-token',
      },
      collector: {
        service: 'blackbox-collector',
        containerPort: 4318,
        runtime: {
          kind: 'mounted-node',
          image: 'node:test@sha256:runtime',
          sourceDirectory: directory,
          targetDirectory: '/blackbox/collector',
          entrypoint: 'instrumentation.js',
          user: 'node',
        },
        environment: { BLACKBOX_OTEL_MAX_REQUEST_BYTES: '1048576' },
        readiness: {
          kind: 'http',
          path: '/ready',
          intervalSeconds: 1,
          timeoutSeconds: 2,
          retries: 20,
        },
        drain: { kind: 'signal', signal: 'SIGTERM' },
      },
      participants: [
        {
          service: 'orders',
          runtime: 'node',
          environment: {},
          activation: {
            kind: 'append-environment-variable',
            name: 'NODE_OPTIONS',
            value: '--import=/blackbox/instrumentation.js',
          },
          mounts: [{ source: bundle, target: '/blackbox/instrumentation.js', access: 'read-only' }],
        },
      ],
    },
  };
}

it('writes a Compose override without retaining the bearer token', async () => {
  const fixture = await telemetryFixture();
  const path = await writeTelemetryComposeOverride({
    ...fixture,
    effectiveEnvironments: new Map([
      ['orders', { NODE_OPTIONS: '--enable-source-maps' }],
    ]),
  });
  const document = await readFile(path, 'utf8');
  expect(document).toContain('node:test@sha256:runtime');
  expect(document).toContain(`${fixture.directory}:/blackbox/collector:ro`);
  expect(document).toContain('node');
  expect(document).toContain('/blackbox/collector/instrumentation.js');
  expect(document).toContain('"user": "node"');
  expect(document).toContain('127.0.0.1::4318');
  expect(document).toContain('${BLACKBOX_SANDBOX_OTEL_INGEST_TOKEN}');
  expect(document).toContain('${BLACKBOX_SANDBOX_OTEL_CONTROL_TOKEN}');
  expect(document).toContain(`${fixture.directory}/instrumentation.js:/blackbox/instrumentation.js:ro`);
  expect(document).toContain(
    '--enable-source-maps --import=/blackbox/instrumentation.js',
  );
  expect(document).not.toContain('private-token');
});

it('injects Blackbox identity and standard OTLP configuration', async () => {
  const { telemetry } = await telemetryFixture();
  const environment = participantEnvironment({
    telemetry,
    participant: telemetry.participants[0],
    ingestToken: 'resolved-token',
    effectiveEnvironment: { NODE_OPTIONS: '--trace-warnings' },
  });
  expect(environment).toMatchObject({
    BLACKBOX_OTEL_SESSION_ID: 'steady-harbor-alex',
    BLACKBOX_OTEL_EXECUTION_ID: 'client-01',
    BLACKBOX_OTEL_SERVICE_NAME: 'orders',
    BLACKBOX_OTEL_RUNTIME: 'node',
    OTEL_SERVICE_NAME: 'orders',
    OTEL_TRACES_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: 'http/json',
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://blackbox-collector:4318/v1/traces',
    OTEL_EXPORTER_OTLP_HEADERS: 'authorization=Bearer resolved-token',
    OTEL_METRICS_EXPORTER: 'none',
    OTEL_LOGS_EXPORTER: 'none',
    NODE_OPTIONS: '--trace-warnings --import=/blackbox/instrumentation.js',
  });
});

it('configures the collector readiness route used by its health check', async () => {
  const { telemetry } = await telemetryFixture();
  const custom = {
    ...telemetry,
    collector: {
      ...telemetry.collector,
      readiness: {
        ...telemetry.collector.readiness,
        path: '/health/collector',
      },
    },
  };
  expect(
    collectorEnvironment(custom, {
      kind: 'split-bearer-tokens',
      ingestToken: 'resolved-ingest-token',
      controlToken: 'resolved-control-token',
    }),
  ).toMatchObject({
    BLACKBOX_OTEL_READINESS_PATH: '/health/collector',
  });
});

it('publishes the retained collector directory from Sandbox ownership coordinates', () => {
  expect(
    sandboxTelemetryStorageDirectory({ recordDirectory: '/records', sandboxId: 'sandbox-1' }),
  ).toBe(join('/records', 'sandbox-1.compose', 'collector'));
});
