import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SandboxTelemetryEnabledInput } from '../types.js';
import { collectorEnvironment, participantEnvironment } from './environment.js';

interface ComposeServiceBase {
  readonly image: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly ports: readonly string[];
  readonly volumes: readonly string[];
  readonly healthcheck: {
    readonly test: readonly string[];
    readonly interval: string;
    readonly timeout: string;
    readonly retries: number;
  };
}

function collectorVolumes(input: {
  readonly telemetry: SandboxTelemetryEnabledInput;
  readonly storageDirectory: string;
}): readonly string[] {
  const storage = `${input.storageDirectory}:/blackbox/telemetry`;
  const runtime = input.telemetry.collector.runtime;
  return runtime.kind === 'image-default'
    ? [storage]
    : [storage, `${runtime.sourceDirectory}:${runtime.targetDirectory}:ro`];
}

function collectorService(input: {
  readonly telemetry: SandboxTelemetryEnabledInput;
  readonly storageDirectory: string;
}): object {
  const base = {
    image: input.telemetry.collector.runtime.image,
    environment: collectorEnvironment(input.telemetry, '${BLACKBOX_SANDBOX_OTEL_AUTH_TOKEN}'),
    ports: [`127.0.0.1::${input.telemetry.collector.containerPort}`],
    volumes: collectorVolumes(input),
    healthcheck: {
      test: [
        'CMD',
        'node',
        '-e',
        `fetch('http://127.0.0.1:${input.telemetry.collector.containerPort}${input.telemetry.collector.readiness.path}').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))`,
      ],
      interval: `${input.telemetry.collector.readiness.intervalSeconds}s`,
      timeout: `${input.telemetry.collector.readiness.timeoutSeconds}s`,
      retries: input.telemetry.collector.readiness.retries,
    },
  } satisfies ComposeServiceBase;
  const runtime = input.telemetry.collector.runtime;
  return runtime.kind === 'image-default'
    ? base
    : {
        ...base,
        user: runtime.user,
        command: ['node', `${runtime.targetDirectory}/${runtime.entrypoint}`],
      };
}

function participantService(input: {
  readonly telemetry: SandboxTelemetryEnabledInput;
  readonly participant: SandboxTelemetryEnabledInput['participants'][number];
}): object {
  return {
    environment: participantEnvironment({
      ...input,
      token: '${BLACKBOX_SANDBOX_OTEL_AUTH_TOKEN}',
    }),
    volumes: input.participant.mounts.map(
      (mount) => `${mount.source}:${mount.target}:ro`,
    ),
    depends_on: {
      [input.telemetry.collector.service]: { condition: 'service_healthy' },
    },
  };
}

export async function writeTelemetryComposeOverride(input: {
  readonly telemetry: SandboxTelemetryEnabledInput;
  readonly directory: string;
}): Promise<string> {
  await mkdir(input.directory, { recursive: true });
  const storageDirectory = join(input.directory, 'collector');
  await mkdir(storageDirectory, { recursive: true });
  const path = join(input.directory, 'telemetry.compose.json');
  const services: Record<string, object> = {};
  services[input.telemetry.collector.service] = collectorService({
    telemetry: input.telemetry,
    storageDirectory,
  });
  for (const participant of input.telemetry.participants) {
    services[participant.service] = participantService({
      telemetry: input.telemetry,
      participant,
    });
  }
  await writeFile(path, `${JSON.stringify({ services }, null, 2)}\n`, 'utf8');
  return path;
}
