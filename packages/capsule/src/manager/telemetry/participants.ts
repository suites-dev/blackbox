import { realpath } from 'node:fs/promises';
import { isAbsolute, posix, relative, resolve, sep } from 'node:path';

import type { CatalogSandboxInput } from '@suites/blackbox-catalog-internal';
import {
  createNodeRuntimeActivation,
  isNodeRuntimeActivationAdapter,
  nodeInstrumentationDirectoryRelativePath,
} from '@suites/blackbox-inst-runtime-node';
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
  readonly ref: string;
}): Promise<{ readonly source: string; readonly bootstrapPath: string }> {
  const projectDirectory = await realpath(input.projectDirectory);
  const requestedSource = resolve(
    projectDirectory,
    nodeInstrumentationDirectoryRelativePath,
  );
  const requestedAsset = resolve(projectDirectory, input.ref);
  if (!containedPath(requestedSource, requestedAsset)) {
    throw new Error(
      `Instrumentation activation ${JSON.stringify(input.ref)} must be inside ${nodeInstrumentationDirectoryRelativePath}`,
    );
  }
  const source = await realpath(requestedSource);
  if (!containedPath(projectDirectory, source)) {
    throw new Error(
      `Instrumentation directory must resolve inside project directory ${JSON.stringify(projectDirectory)}`,
    );
  }
  const asset = await realpath(requestedAsset);
  const assetRelativePath = relative(source, asset);
  if (!containedPath(source, asset)) {
    throw new Error(
      `Instrumentation activation ${JSON.stringify(input.ref)} must be inside ${nodeInstrumentationDirectoryRelativePath}`,
    );
  }
  return {
    source,
    bootstrapPath: posix.join(
      '/blackbox/instrumentation',
      ...assetRelativePath.split(sep),
    ),
  };
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
    if (participant.runtime !== 'node') {
      throw new Error(
        `Activation for runtime ${JSON.stringify(participant.runtime)} is unsupported`,
      );
    }
    const activation = input.plan.metadata.activations[participant.activation.activationId];
    if (!isNodeRuntimeActivationAdapter(activation.adapter)) {
      throw new Error(`Unsupported Node activation adapter ${JSON.stringify(activation.adapter)}`);
    }
    const target = '/blackbox/instrumentation';
    const asset = await instrumentationAsset({
      projectDirectory: input.plan.projectDirectory,
      ref: activation.ref,
    });
    const configured = createNodeRuntimeActivation({
      kind: 'node-runtime-activation',
      adapter: activation.adapter,
      bootstrapPath: asset.bootstrapPath,
      dependencyDirectory: `${target}/node_modules`,
      inheritedNodeOptions: { kind: 'absent' },
    });
    participants.push({
      service: participant.service,
      runtime: participant.runtime,
      environment: {},
      activation: {
        kind: 'append-environment-variable',
        name: 'NODE_OPTIONS',
        value: configured.environment.NODE_OPTIONS,
      },
      mounts: [
        {
          source: asset.source,
          target,
          access: 'read-only',
        },
      ],
    });
  }
  return participants;
}
