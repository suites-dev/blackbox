import type { CatalogSandboxInput } from '@suites/blackbox-catalog';
import { nodeRuntimeActivationAdapters } from '@suites/blackbox-inst-runtime-node';
import type { startSandbox, SandboxHandle } from '@suites/blackbox-sandbox';

import type { resolveCollectorRuntime } from './collector-runtime.js';
import type { createSandboxTelemetry, TelemetryAuthorization } from './telemetry.js';

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
    progress: { kind: 'silent' },
  });
}
