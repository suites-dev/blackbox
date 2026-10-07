import type { CatalogSandboxInput } from '@suites/blackbox-catalog';
import { nodeRuntimeActivationAdapters } from '@suites/blackbox-inst-runtime-node';
import type { startSandbox, SandboxHandle } from '@suites/blackbox-sandbox';

import type { resolveCollectorRuntime } from './collector-runtime.js';
import type { createSandboxTelemetry, TelemetryAuthorization } from './telemetry.js';
import type { BlackboxEntrypoint, BlackboxSandbox } from '../types.js';
import type { AttemptProgress } from '../reporting/events.js';
import { reportSandboxProgress } from '../reporting/sandbox-progress.js';

interface SandboxStartPorts {
  readonly resolveCollectorRuntime: typeof resolveCollectorRuntime;
  readonly createTelemetry: typeof createSandboxTelemetry;
  readonly startSandbox: typeof startSandbox;
}

export async function startAttemptSandbox(input: {
  readonly plan: CatalogSandboxInput;
  readonly sessionId: string;
  readonly executionId: string;
  readonly authorization: TelemetryAuthorization;
  readonly recordDirectory: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly ports: SandboxStartPorts;
  readonly progress: AttemptProgress;
}): Promise<SandboxHandle> {
  const collectorRuntime = await input.ports.resolveCollectorRuntime();
  const telemetry = await input.ports.createTelemetry({
    plan: input.plan,
    sessionId: input.sessionId,
    executionId: input.executionId,
    authorization: input.authorization,
    collectorRuntime,
    adapters: nodeRuntimeActivationAdapters,
  });
  return input.ports.startSandbox({
    sandbox: {
      sandboxId: input.executionId,
      projectDirectory: input.plan.projectDirectory,
      composeFiles: input.plan.composeFiles,
      recordDirectory: input.recordDirectory,
      environment: { ...input.plan.environment, ...input.environment },
      serviceSelection: { kind: 'selected', services: input.plan.services },
      endpoints: input.plan.endpoints.map(({ name, service, containerPort }) => ({
        name,
        service,
        containerPort,
      })),
      startupTimeoutMs: Math.max(
        ...input.plan.readiness.map(({ timeoutMs }) => timeoutMs),
        120_000,
      ),
      stopTimeoutMs: 60_000,
      telemetry,
    },
    progress: {
      kind: 'events',
      sink: {
        emit: (event) => {
          reportSandboxProgress(input.progress, event);
        },
      },
    },
  });
}

/** Sandbox identity owned by the runtime; the fixture adds `exec`. */
export type AttemptSandbox = Omit<BlackboxSandbox, 'exec'>;

function entrypoint(input: {
  readonly plan: CatalogSandboxInput;
  readonly sandbox: SandboxHandle;
}): BlackboxEntrypoint {
  const declared = input.plan.endpoints.find((candidate) => candidate.name === 'entrypoint');
  const mapped = input.sandbox.endpoints.get('entrypoint');
  if (declared === undefined || mapped === undefined) {
    throw new Error('Selected catalog entry did not produce the required entrypoint endpoint');
  }
  return {
    url: `${declared.protocol}://${mapped.host}:${mapped.port}`,
    host: mapped.host,
    port: mapped.port,
    protocol: declared.protocol,
  };
}

export function publicSandbox(input: {
  readonly plan: CatalogSandboxInput;
  readonly sandbox: SandboxHandle;
  readonly executionId: string;
  readonly artifactDirectory: string;
}): AttemptSandbox {
  return Object.freeze({
    sandboxId: input.sandbox.sandboxId,
    executionId: input.executionId,
    catalogEntry: Object.freeze({
      id: input.plan.catalogEntryId,
      kind: input.plan.metadata.kind,
    }),
    projectName: input.sandbox.projectName,
    artifactDirectory: input.artifactDirectory,
    entrypoint: Object.freeze(entrypoint(input)),
    containers: input.sandbox.containers,
  });
}
