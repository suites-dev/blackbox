import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { SandboxTelemetryEnabledInput } from '../types.js';
import { writeTelemetryComposeOverride } from './compose-override.js';
import { participantEnvironment } from './environment.js';

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
      authorization: { kind: 'bearer-token', token: 'private-token' },
      collector: {
        service: 'blackbox-collector',
        image: 'blackbox-collector:local',
        containerPort: 4318,
        command: { kind: 'image-default' },
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
          environment: { NODE_OPTIONS: '--import=/blackbox/instrumentation.js' },
          mounts: [{ source: bundle, target: '/blackbox/instrumentation.js', access: 'read-only' }],
        },
      ],
    },
  };
}

it('writes a Compose override without retaining the bearer token', async () => {
  const fixture = await telemetryFixture();
  const path = await writeTelemetryComposeOverride(fixture);
  const document = await readFile(path, 'utf8');
  expect(document).toContain('blackbox-collector:local');
  expect(document).toContain('127.0.0.1::4318');
  expect(document).toContain('${BLACKBOX_SANDBOX_OTEL_AUTH_TOKEN}');
  expect(document).toContain(`${fixture.directory}/instrumentation.js:/blackbox/instrumentation.js:ro`);
  expect(document).not.toContain('private-token');
});

it('injects Blackbox identity and standard OTLP configuration', async () => {
  const { telemetry } = await telemetryFixture();
  const environment = participantEnvironment({
    telemetry,
    participant: telemetry.participants[0],
    token: 'resolved-token',
  });
  expect(environment).toMatchObject({
    BLACKBOX_OTEL_SESSION_ID: 'steady-harbor-alex',
    BLACKBOX_OTEL_EXECUTION_ID: 'client-01',
    BLACKBOX_OTEL_SERVICE_NAME: 'orders',
    BLACKBOX_OTEL_RUNTIME: 'node',
    OTEL_TRACES_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: 'http/json',
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://blackbox-collector:4318/v1/traces',
    OTEL_EXPORTER_OTLP_HEADERS: 'authorization=Bearer resolved-token',
    OTEL_METRICS_EXPORTER: 'none',
    OTEL_LOGS_EXPORTER: 'none',
  });
});
