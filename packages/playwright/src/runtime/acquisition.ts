import { randomBytes, randomUUID } from 'node:crypto';

import {
  loadCatalogFile,
  resolveCatalogEntry,
  type CatalogSandboxInput,
  type LoadedCatalog,
} from '@suites/blackbox-catalog';
import { readCollectorSession, readCollectorTrace } from '@suites/blackbox-otel-collector';
import {
  sandboxTelemetryStorageDirectory,
  startSandbox,
  type SandboxHandle,
  type SandboxStopReason,
} from '@suites/blackbox-sandbox';

import type {
  BlackboxCatalogSelection,
  BlackboxEntrypoint,
  BlackboxSandbox,
  BlackboxTelemetry,
} from '../types.js';
import { verifyRequiredActivations } from './activation.js';
import { resolveCollectorRuntime } from './collector-runtime.js';
import { awaitReadiness } from './readiness.js';
import { startAttemptSandbox } from './sandbox-start.js';
import { createSandboxTelemetry, type TelemetryAuthorization } from './telemetry.js';

export interface BlackboxAttemptInput {
  readonly selection: BlackboxCatalogSelection;
  readonly configFile: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly artifactDirectory: string;
}

export interface RunningBlackboxAttempt {
  readonly sandbox: BlackboxSandbox;
  readonly telemetry: BlackboxTelemetry;
  stop(reason: SandboxStopReason): Promise<void>;
}

export interface BlackboxAttemptRuntime {
  start(input: BlackboxAttemptInput): Promise<RunningBlackboxAttempt>;
}

export interface BlackboxAcquisitionPorts {
  readonly loadCatalog: typeof loadCatalogFile;
  readonly resolveCatalog: typeof resolveCatalogEntry;
  readonly startSandbox: typeof startSandbox;
  readonly resolveCollectorRuntime: typeof resolveCollectorRuntime;
  readonly createTelemetry: typeof createSandboxTelemetry;
  readonly verifyActivations: typeof verifyRequiredActivations;
  readonly awaitReadiness: typeof awaitReadiness;
  readonly randomId: () => string;
  readonly randomToken: () => string;
}

const productionPorts = {
  loadCatalog: loadCatalogFile,
  resolveCatalog: resolveCatalogEntry,
  startSandbox,
  resolveCollectorRuntime,
  createTelemetry: createSandboxTelemetry,
  verifyActivations: verifyRequiredActivations,
  awaitReadiness,
  randomId: randomUUID,
  randomToken: () => randomBytes(32).toString('base64url'),
} satisfies BlackboxAcquisitionPorts;

function selectedPlan(input: {
  readonly selection: BlackboxCatalogSelection;
  readonly catalog: LoadedCatalog;
  readonly ports: BlackboxAcquisitionPorts;
}): CatalogSandboxInput {
  if (input.selection.kind === 'unselected') {
    throw new Error(
      'Blackbox catalog entry is not selected. Declare test.use({ catalogEntry: { kind, id } }).',
    );
  }
  const plan = input.ports.resolveCatalog({
    catalog: input.catalog,
    selection: { kind: 'explicit-entry', entryId: input.selection.id },
  });
  if (plan.metadata.kind !== input.selection.kind) {
    throw new Error(
      `Catalog entry ${JSON.stringify(input.selection.id)} is ${JSON.stringify(plan.metadata.kind)}, ` +
        `not ${JSON.stringify(input.selection.kind)}.`,
    );
  }
  if (plan.metadata.isolation.kind !== 'per-test') {
    throw new Error(
      `Catalog entry ${JSON.stringify(input.selection.id)} declares ${JSON.stringify(plan.metadata.isolation.kind)} isolation. ` +
        'Native Playwright execution requires catalog isolation kind "per-test".',
    );
  }
  return plan;
}

function authorization(ports: BlackboxAcquisitionPorts): TelemetryAuthorization {
  return {
    kind: 'split-bearer-tokens',
    ingestToken: ports.randomToken(),
    controlToken: ports.randomToken(),
  };
}

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

async function verifyReadiness(input: {
  readonly plan: CatalogSandboxInput;
  readonly sandbox: SandboxHandle;
  readonly ports: BlackboxAcquisitionPorts;
}): Promise<void> {
  for (const readiness of input.plan.readiness) {
    const mapped = input.sandbox.endpoints.get(readiness.name);
    if (mapped === undefined) {
      throw new Error(
        `Sandbox did not return readiness endpoint ${JSON.stringify(readiness.name)}`,
      );
    }
    await input.ports.awaitReadiness({
      entrypoint: {
        url: `${readiness.protocol}://${mapped.host}:${mapped.port}`,
        host: mapped.host,
        port: mapped.port,
        protocol: readiness.protocol,
      },
      path: readiness.path,
      timeoutMs: readiness.timeoutMs,
    });
  }
}

function publicTelemetry(input: {
  readonly sandbox: SandboxHandle;
  readonly recordDirectory: string;
  readonly sessionId: string;
  readonly executionId: string;
}): BlackboxTelemetry {
  const identity = {
    sessionId: input.sessionId,
    executionId: input.executionId,
    storageDirectory: sandboxTelemetryStorageDirectory({
      recordDirectory: input.recordDirectory,
      sandboxId: input.executionId,
    }),
  };
  return Object.freeze({
    sessionId: input.sessionId,
    executionId: input.executionId,
    inspect: () => input.sandbox.inspectTelemetry(),
    read: () => readCollectorSession(identity),
    readTrace: (traceId: string) => readCollectorTrace({ ...identity, traceId }),
  });
}

async function cleanupAfterSetupFailure(input: {
  readonly sandbox: SandboxHandle;
  readonly cause: unknown;
}): Promise<never> {
  try {
    await input.sandbox.stop({ reason: 'failed' });
  } catch (cleanupError) {
    throw new AggregateError(
      [input.cause, cleanupError],
      'Blackbox Playwright setup and sandbox cleanup both failed',
    );
  }
  throw input.cause;
}

export async function acquireBlackboxAttempt(
  input: BlackboxAttemptInput,
  ports: BlackboxAcquisitionPorts = productionPorts,
): Promise<RunningBlackboxAttempt> {
  const catalog = await ports.loadCatalog({ configFile: input.configFile });
  const plan = selectedPlan({ selection: input.selection, catalog, ports });
  const sessionId = `playwright-${ports.randomId()}`;
  const executionId = `playwright-${ports.randomId()}`;
  const recordDirectory = input.artifactDirectory;
  const collectorAuthorization = authorization(ports);
  const sandbox = await startAttemptSandbox({
    plan,
    sessionId,
    executionId,
    authorization: collectorAuthorization,
    recordDirectory,
    environment: input.environment,
    ports,
  });
  try {
    await ports.verifyActivations({
      plan,
      sandbox,
      authorization: collectorAuthorization,
      sessionId,
      executionId,
      timeoutMs: Math.max(...plan.readiness.map(({ timeoutMs }) => timeoutMs), 1),
    });
    await verifyReadiness({ plan, sandbox, ports });
    const selectedEntrypoint = entrypoint({ plan, sandbox });
    const publicSandbox = Object.freeze({
      sandboxId: sandbox.sandboxId,
      executionId,
      catalogEntry: Object.freeze({
        id: plan.catalogEntryId,
        kind: plan.metadata.kind,
        declaredIsolation: plan.metadata.isolation,
      }),
      projectName: sandbox.projectName,
      artifactDirectory: input.artifactDirectory,
      entrypoint: Object.freeze(selectedEntrypoint),
      containers: sandbox.containers,
    }) satisfies BlackboxSandbox;
    return {
      sandbox: publicSandbox,
      telemetry: publicTelemetry({
        sandbox,
        recordDirectory,
        sessionId,
        executionId,
      }),
      async stop(reason): Promise<void> {
        await sandbox.stop({ reason });
      },
    };
  } catch (cause) {
    return cleanupAfterSetupFailure({ sandbox, cause });
  }
}

export const productionBlackboxRuntime = {
  start: (input) => acquireBlackboxAttempt(input),
} satisfies BlackboxAttemptRuntime;
