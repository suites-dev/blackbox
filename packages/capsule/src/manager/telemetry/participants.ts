import { isAbsolute, posix, relative, resolve, sep } from 'node:path';

import type { CatalogSandboxInput } from '@suites/blackbox-catalog-internal';
import {
  createNodeRuntimeActivation,
  isNodeRuntimeActivationAdapter,
  nodeInstrumentationDirectoryRelativePath,
} from '@suites/blackbox-inst-runtime-node';
import type { SandboxTelemetryParticipant } from '@suites/blackbox-sandbox-internal';

import type { CapsuleManagerBootstrap } from '../../protocol.js';

function instrumentationAsset(input: {
  readonly projectDirectory: string;
  readonly ref: string;
}): { readonly source: string; readonly bootstrapPath: string } {
  const source = resolve(input.projectDirectory, nodeInstrumentationDirectoryRelativePath);
  const asset = resolve(input.projectDirectory, input.ref);
  const assetRelativePath = relative(source, asset);
  if (
    assetRelativePath === '' ||
    assetRelativePath.startsWith(`..${sep}`) ||
    assetRelativePath === '..' ||
    isAbsolute(assetRelativePath)
  ) {
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

export function participantTelemetry(input: {
  readonly plan: CatalogSandboxInput;
  readonly bootstrap: CapsuleManagerBootstrap;
}): readonly SandboxTelemetryParticipant[] {
  return Object.values(input.plan.metadata.participants).flatMap((participant) => {
    if (participant.activation.kind === 'unconfigured') {
      return [];
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
    const asset = instrumentationAsset({
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
    return [
      {
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
      },
    ];
  });
}
