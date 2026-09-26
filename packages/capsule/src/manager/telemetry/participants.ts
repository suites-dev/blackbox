import { realpath } from 'node:fs/promises';
import { isAbsolute, posix, relative, resolve, sep } from 'node:path';

import type { CatalogSandboxInput } from '@suites/blackbox-catalog-internal';
import type {
  RuntimeActivationAdapter,
  RuntimeActivationValuePart,
} from '@suites/blackbox-instrumentation-internal';
import type { SandboxTelemetryParticipant } from '@suites/blackbox-sandbox-internal';

import type { CapsuleManagerBootstrap } from '../../protocol.js';

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
  if (!containedPath(projectDirectory, source)) {
    throw new Error(
      `Instrumentation directory must resolve inside project directory ${JSON.stringify(projectDirectory)}`,
    );
  }
  const asset = await realpath(requestedAsset);
  if (!containedPath(source, asset)) {
    throw new Error(
      `Instrumentation activation ${JSON.stringify(input.ref)} must be inside ${input.sourceDirectoryRelativePath}`,
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
  readonly bootstrap: CapsuleManagerBootstrap;
  readonly runtime: string;
  readonly adapter: string;
}): RuntimeActivationAdapter {
  const selected = input.bootstrap.runtimeActivationAdapters.find(
    (candidate) => candidate.runtime === input.runtime && candidate.adapter === input.adapter,
  );
  if (selected === undefined) {
    throw new Error(
      `Activation adapter ${JSON.stringify(input.adapter)} for runtime ${JSON.stringify(input.runtime)} is unavailable`,
    );
  }
  return selected;
}

export async function participantTelemetry(input: {
  readonly plan: CatalogSandboxInput;
  readonly bootstrap: CapsuleManagerBootstrap;
}): Promise<readonly SandboxTelemetryParticipant[]> {
  const participants: SandboxTelemetryParticipant[] = [];
  for (const participant of Object.values(input.plan.metadata.participants)) {
    if (participant.activation.kind === 'unconfigured') {
      continue;
    }
    const activation = input.plan.metadata.activations[participant.activation.activationId];
    const adapter = adapterFor({
      bootstrap: input.bootstrap,
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
      mounts: [
        {
          source: asset.source,
          target: adapter.targetDirectory,
          access: 'read-only',
        },
      ],
    });
  }
  return participants;
}
