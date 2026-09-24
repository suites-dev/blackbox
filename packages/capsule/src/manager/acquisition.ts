import type { CatalogEntry, CatalogSandboxInput } from '@suites/blackbox-catalog-internal';
import type { SandboxHandle } from '@suites/blackbox-sandbox-internal';

import { awaitReadiness } from '../execution/commands.js';
import type { CapsuleManagerBootstrap } from '../protocol.js';
import { capsuleSandboxRecordDirectory, recordedError } from '../records.js';
import type {
  CapsuleContainerDetails,
  CapsuleEntrypoint,
  CapsuleReadinessDetails,
} from '../types.js';
import { CapsuleStageError, emitProgress, runStartStage } from './progress.js';
import type { CapsuleManagerPorts } from './ports.js';
import { sandboxProgressBridge } from './sandbox-progress.js';

export interface AcquiredCapsuleSandbox {
  readonly sandbox: SandboxHandle;
  readonly entrypoint: CapsuleEntrypoint;
  readonly containers: readonly CapsuleContainerDetails[];
  readonly networks: readonly string[];
  readonly volumes: readonly string[];
  readonly readiness: CapsuleReadinessDetails;
}

function entrypoint(sandbox: SandboxHandle, protocol: string): CapsuleEntrypoint {
  const endpoint = sandbox.endpoints.get('entrypoint');
  if (endpoint === undefined) {
    throw new Error('Sandbox did not return the required entrypoint');
  }
  return {
    url: `${protocol}://${endpoint.host}:${endpoint.port}`,
    host: endpoint.host,
    port: endpoint.port,
    protocol,
  };
}

async function publishAcquisition(input: {
  readonly bootstrap: CapsuleManagerBootstrap;
  readonly sandbox: SandboxHandle;
  readonly entry: CatalogEntry;
  readonly capsuleEntrypoint: CapsuleEntrypoint;
}): Promise<readonly CapsuleContainerDetails[]> {
  const containers = Object.entries(input.entry.participants).map(([participant, config]) => {
    const view = input.sandbox.getContainer({ service: config.service });
    return {
      participant,
      service: config.service,
      containerId: view.testcontainer.id,
      containerName: view.testcontainer.name,
      host: view.testcontainer.host,
      networkNames: [...view.testcontainer.networkNames],
    };
  });
  await emitProgress(input.bootstrap, {
    kind: 'endpoint-mapped',
    sessionId: input.bootstrap.sessionId,
    endpoint: input.capsuleEntrypoint,
  });
  return containers;
}

async function verifyReadiness(input: {
  readonly bootstrap: CapsuleManagerBootstrap;
  readonly entry: CatalogEntry;
  readonly entrypoint: CapsuleEntrypoint;
}): Promise<CapsuleReadinessDetails> {
  const started = Date.now();
  const url = new URL(input.entry.entrypoint.readiness.path, `${input.entrypoint.url}/`).toString();
  await emitProgress(input.bootstrap, {
    kind: 'readiness-started',
    sessionId: input.bootstrap.sessionId,
    url,
    timeoutMs: input.entry.entrypoint.readiness.timeoutMs,
  });
  await runStartStage('readiness', () =>
    awaitReadiness({
      entrypoint: input.entrypoint,
      path: input.entry.entrypoint.readiness.path,
      timeoutMs: input.entry.entrypoint.readiness.timeoutMs,
    }),
  );
  const readiness = {
    url,
    status: 'ready',
    durationMs: Date.now() - started,
  } satisfies CapsuleReadinessDetails;
  await emitProgress(input.bootstrap, {
    kind: 'readiness-succeeded',
    sessionId: input.bootstrap.sessionId,
    url,
    durationMs: readiness.durationMs,
  });
  return readiness;
}

interface PlannedSandboxInput {
  readonly bootstrap: CapsuleManagerBootstrap;
  readonly plan: CatalogSandboxInput;
  readonly entry: CatalogEntry;
  readonly ports: CapsuleManagerPorts;
}

export async function startPlannedSandbox(input: PlannedSandboxInput): Promise<{
  readonly sandbox: SandboxHandle;
  readonly flushProgress: () => Promise<void>;
}> {
  const projectName = input.ports.sandbox.projectName({ sandboxId: input.bootstrap.executionId });
  await emitProgress(input.bootstrap, {
    kind: 'compose-configured',
    sessionId: input.bootstrap.sessionId,
    projectName,
  });
  await emitProgress(input.bootstrap, {
    kind: 'acquisition-started',
    sessionId: input.bootstrap.sessionId,
    projectName,
  });
  const progress = sandboxProgressBridge({ bootstrap: input.bootstrap, entry: input.entry });
  const operation = runStartStage('acquisition', () =>
    input.ports.sandbox.start({
      sandbox: {
        sandboxId: input.bootstrap.executionId,
        projectDirectory: input.plan.projectDirectory,
        composeFiles: input.plan.composeFiles,
        recordDirectory: capsuleSandboxRecordDirectory(input.bootstrap),
        environment: { ...input.plan.environment, ...input.bootstrap.environment },
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
      },
      progress: progress.mode,
    }),
  );
  let sandbox: SandboxHandle;
  try {
    sandbox = await operation;
  } catch (error) {
    try {
      await progress.flush();
    } catch (persistenceError) {
      throw combinedStartFailure({ error, persistenceError });
    }
    throw error;
  }
  return { sandbox, flushProgress: () => runStartStage('persistence', progress.flush) };
}

export async function completePlannedSandbox(
  input: PlannedSandboxInput & { readonly sandbox: SandboxHandle },
): Promise<AcquiredCapsuleSandbox> {
  const sandbox = input.sandbox;
  const capsuleEntrypoint = entrypoint(sandbox, input.entry.entrypoint.protocol);
  const containers = await publishAcquisition({ ...input, sandbox, capsuleEntrypoint });
  const resources = sandbox.inspectResources({ kind: 'owned-compose-resources' });
  const networks = resources.networks.map(({ name }) => name).sort();
  const volumes = resources.volumes.map(({ name }) => name).sort();
  const readiness = await verifyReadiness({
    bootstrap: input.bootstrap,
    entry: input.entry,
    entrypoint: capsuleEntrypoint,
  });
  return { sandbox, entrypoint: capsuleEntrypoint, containers, networks, volumes, readiness };
}

function combinedStartFailure(input: {
  readonly error: unknown;
  readonly persistenceError: unknown;
}): CapsuleStageError {
  const acquisition = recordedError(input.error);
  const persistence = recordedError(input.persistenceError);
  return new CapsuleStageError(
    'persistence',
    new AggregateError(
      [input.error, input.persistenceError],
      `Acquisition failed: ${acquisition.message}; progress persistence failed: ${persistence.message}`,
    ),
  );
}
