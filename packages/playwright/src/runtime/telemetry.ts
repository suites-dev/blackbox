import { realpath } from 'node:fs/promises';
import { isAbsolute, posix, relative, resolve, sep } from 'node:path';

import type { CatalogSandboxInput } from '@suites/blackbox-catalog';
import {
  unavailableRuntimeActivationAdapterMessage,
  type RuntimeActivationAdapter,
  type RuntimeActivationValuePart,
} from '@suites/blackbox-instrumentation';
import type {
  SandboxCollectorRuntime,
  SandboxTelemetryEnabledInput,
  SandboxTelemetryParticipant,
} from '@suites/blackbox-sandbox';

export interface TelemetryAuthorization {
  readonly kind: 'split-bearer-tokens';
  readonly ingestToken: string;
  readonly controlToken: string;
}

function containedPath(parent: string, candidate: string): boolean {
  const candidateRelativePath = relative(parent, candidate);
  return (
    candidateRelativePath !== '' &&
    candidateRelativePath !== '..' &&
    !candidateRelativePath.startsWith(`..${sep}`) &&
    !isAbsolute(candidateRelativePath)
  );
}

async function instrumentationAsset(input: {
  readonly projectDirectory: string;
  readonly sourceDirectoryRelativePath: string;
  readonly targetDirectory: string;
  readonly ref: string;
}): Promise<{ readonly source: string; readonly mountedAssetPath: string }> {
  const projectDirectory = await realpath(input.projectDirectory);
  const requestedSource = resolve(projectDirectory, input.sourceDirectoryRelativePath);
  const requestedAsset = resolve(projectDirectory, input.ref);
  if (
    !containedPath(projectDirectory, requestedSource) ||
    !containedPath(requestedSource, requestedAsset)
  ) {
    throw new Error(
      `Instrumentation activation ${JSON.stringify(input.ref)} must be inside ${input.sourceDirectoryRelativePath}`,
    );
  }
  const source = await realpath(requestedSource);
  const asset = await realpath(requestedAsset);
  if (!containedPath(projectDirectory, source) || !containedPath(source, asset)) {
    throw new Error(
      `Instrumentation activation ${JSON.stringify(input.ref)} escapes its project instrumentation directory`,
    );
  }
  const assetRelativePath = relative(source, asset);
  return {
    source,
    mountedAssetPath: posix.join(input.targetDirectory, ...assetRelativePath.split(sep)),
  };
}

function activationPart(input: {
  readonly part: RuntimeActivationValuePart;
  readonly adapter: RuntimeActivationAdapter;
  readonly mountedAssetPath: string;
}): string {
  if (input.part.kind === 'activation-asset-path') {
    return `${input.part.prefix}${input.mountedAssetPath}`;
  }
  return `${input.part.prefix}${posix.join(
    input.adapter.targetDirectory,
    input.part.relativePath,
  )}`;
}

function adapterFor(input: {
  readonly adapters: readonly RuntimeActivationAdapter[];
  readonly runtime: string;
  readonly adapter: string;
}): RuntimeActivationAdapter {
  const selected = input.adapters.find(
    (candidate) => candidate.runtime === input.runtime && candidate.adapter === input.adapter,
  );
  if (selected === undefined) {
    throw new Error(unavailableRuntimeActivationAdapterMessage(input));
  }
  return selected;
}

async function participantTelemetry(input: {
  readonly plan: CatalogSandboxInput;
  readonly adapters: readonly RuntimeActivationAdapter[];
}): Promise<readonly SandboxTelemetryParticipant[]> {
  const participants: SandboxTelemetryParticipant[] = [];
  for (const participant of Object.values(input.plan.metadata.participants)) {
    if (participant.activation.kind === 'unconfigured') {
      continue;
    }
    const activation = input.plan.metadata.activations[participant.activation.activationId];
    const adapter = adapterFor({
      adapters: input.adapters,
      runtime: participant.runtime,
      adapter: activation.adapter,
    });
    const asset = await instrumentationAsset({
      projectDirectory: input.plan.projectDirectory,
      sourceDirectoryRelativePath: adapter.sourceDirectoryRelativePath,
      targetDirectory: adapter.targetDirectory,
      ref: activation.ref,
    });
    participants.push({
      service: participant.service,
      runtime: participant.runtime,
      environment: {},
      activation: {
        kind: adapter.environment.kind,
        name: adapter.environment.name,
        value: adapter.environment.value
          .map((part) =>
            activationPart({ part, adapter, mountedAssetPath: asset.mountedAssetPath }),
          )
          .join(adapter.environment.separator),
      },
      mounts: [{ source: asset.source, target: adapter.targetDirectory, access: 'read-only' }],
    });
  }
  return participants;
}

export async function createSandboxTelemetry(input: {
  readonly plan: CatalogSandboxInput;
  readonly sessionId: string;
  readonly executionId: string;
  readonly authorization: TelemetryAuthorization;
  readonly collectorRuntime: SandboxCollectorRuntime;
  readonly adapters: readonly RuntimeActivationAdapter[];
}): Promise<SandboxTelemetryEnabledInput> {
  return {
    kind: 'enabled',
    sessionId: input.sessionId,
    executionId: input.executionId,
    authorization: input.authorization,
    collector: {
      service: 'blackbox-otel-collector',
      containerPort: 4318,
      runtime: input.collectorRuntime,
      environment: {
        BLACKBOX_OTEL_MAX_REQUEST_BYTES: String(16 * 1024 * 1024),
        BLACKBOX_OTEL_MAX_RETAINED_BYTES: String(256 * 1024 * 1024),
        BLACKBOX_OTEL_MAX_RETAINED_FRAGMENTS: '4096',
        BLACKBOX_OTEL_SHUTDOWN_TIMEOUT_MS: '10000',
      },
      readiness: {
        kind: 'http',
        path: '/ready',
        intervalSeconds: 1,
        timeoutSeconds: 3,
        retries: 60,
      },
      drain: { kind: 'signal', signal: 'SIGTERM' },
    },
    participants: await participantTelemetry({ plan: input.plan, adapters: input.adapters }),
  };
}
