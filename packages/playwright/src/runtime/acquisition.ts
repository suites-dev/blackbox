import { randomBytes, randomUUID } from 'node:crypto';

import {
  loadCatalogFile,
  resolveCatalogEntry,
  type CatalogSandboxInput,
  type LoadedCatalog,
} from '@suites/blackbox-catalog';
import { startSandbox, type SandboxHandle, type SandboxStopReason } from '@suites/blackbox-sandbox';

import type {
  BlackboxCatalogSelection,
  BlackboxEffects,
  BlackboxEntrypoint,
  BlackboxSandbox,
} from '../types.js';
import { createUnavailableBlackboxEffects } from '../effects/runtime.js';
import { reported, type AttemptProgress } from '../reporting/events.js';
import { verifyRequiredActivations } from './activation.js';
import { resolveCollectorRuntime } from './collector-runtime.js';
import { awaitReadiness } from './readiness.js';
import { startAttemptSandbox } from './sandbox-start.js';
import { createSandboxTelemetry, type TelemetryAuthorization } from './telemetry.js';
import { publicTelemetry, type AttemptTelemetry } from './telemetry-handle.js';
import {
  participantActivities,
  type ParticipantActivityRunner,
} from '../activity/participant-activity.js';

export interface BlackboxAttemptInput {
  readonly selection: BlackboxCatalogSelection;
  readonly configFile: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly artifactDirectory: string;
  readonly progress: AttemptProgress;
}

/** Sandbox identity owned by the runtime; the fixture adds `exec`. */
export type AttemptSandbox = Omit<BlackboxSandbox, 'exec'>;

export interface RunningBlackboxAttempt {
  readonly sandbox: AttemptSandbox;
  readonly telemetry: AttemptTelemetry;
  readonly effects: BlackboxEffects;
  stop(reason: SandboxStopReason): Promise<void>;
  /** Run one setup command in a participant and export its activity root span. */
  readonly runActivity: ParticipantActivityRunner;
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
  readonly createEffects: (input: {
    readonly sessionId: string;
    readonly executionId: string;
    readonly telemetry: AttemptTelemetry;
  }) => BlackboxEffects;
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
  createEffects: createUnavailableBlackboxEffects,
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
  readonly progress: AttemptProgress;
}): Promise<void> {
  for (const readiness of input.plan.readiness) {
    const mapped = input.sandbox.endpoints.get(readiness.name);
    if (mapped === undefined) {
      throw new Error(
        `Sandbox did not return readiness endpoint ${JSON.stringify(readiness.name)}`,
      );
    }
    await reported(input.progress, 'readiness', `${readiness.name} ${readiness.path}`, () =>
      input.ports.awaitReadiness({
        entrypoint: {
          url: `${readiness.protocol}://${mapped.host}:${mapped.port}`,
          host: mapped.host,
          port: mapped.port,
          protocol: readiness.protocol,
        },
        path: readiness.path,
        timeoutMs: readiness.timeoutMs,
      }),
    );
  }
}

async function cleanupAfterSetupFailure(input: {
  readonly sandbox: SandboxHandle;
  readonly cause: unknown;
  readonly progress: AttemptProgress;
}): Promise<never> {
  try {
    await reported(input.progress, 'teardown', 'setup failed; release owned resources', () =>
      input.sandbox.stop({ reason: 'failed' }),
    );
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
  const plan = await reported(
    input.progress,
    'catalog',
    input.selection.kind === 'unselected'
      ? 'no entry selected'
      : `${input.selection.kind} ${input.selection.id}`,
    async () => {
      const catalog = await ports.loadCatalog({ configFile: input.configFile });
      return selectedPlan({ selection: input.selection, catalog, ports });
    },
  );
  input.progress.protect(plan.environment);
  const sessionId = `playwright-${ports.randomId()}`;
  const executionId = `playwright-${ports.randomId()}`;
  // startAttemptSandbox names the sandbox after its execution.
  input.progress.identify(executionId);
  const recordDirectory = input.artifactDirectory;
  const collectorAuthorization = authorization(ports);
  const sandbox = await reported(input.progress, 'acquisition', plan.services.join(', '), () =>
    startAttemptSandbox({
      plan,
      sessionId,
      executionId,
      authorization: collectorAuthorization,
      recordDirectory,
      environment: input.environment,
      ports,
      progress: input.progress,
    }),
  );
  try {
    await reported(input.progress, 'instrumentation', 'required activations', () =>
      ports.verifyActivations({
        plan,
        sandbox,
        authorization: collectorAuthorization,
        sessionId,
        executionId,
        timeoutMs: Math.max(...plan.readiness.map(({ timeoutMs }) => timeoutMs), 1),
      }),
    );
    await verifyReadiness({ plan, sandbox, ports, progress: input.progress });
    const selectedEntrypoint = entrypoint({ plan, sandbox });
    const publicSandbox = Object.freeze({
      sandboxId: sandbox.sandboxId,
      executionId,
      catalogEntry: Object.freeze({
        id: plan.catalogEntryId,
        kind: plan.metadata.kind,
      }),
      projectName: sandbox.projectName,
      artifactDirectory: input.artifactDirectory,
      entrypoint: Object.freeze(selectedEntrypoint),
      containers: sandbox.containers,
    }) satisfies AttemptSandbox;
    const exposedTelemetry = publicTelemetry({
      sandbox,
      recordDirectory,
      sessionId,
      executionId,
    });
    return {
      sandbox: publicSandbox,
      telemetry: exposedTelemetry,
      effects: ports.createEffects({ sessionId, executionId, telemetry: exposedTelemetry }),
      async stop(reason): Promise<void> {
        await sandbox.stop({ reason });
      },
      ...participantActivities({ sandbox, sessionId, plan, authorization: collectorAuthorization }),
    };
  } catch (cause) {
    return cleanupAfterSetupFailure({ sandbox, cause, progress: input.progress });
  }
}

export const productionBlackboxRuntime = {
  start: (input) => acquireBlackboxAttempt(input),
} satisfies BlackboxAttemptRuntime;
