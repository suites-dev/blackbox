import { basename, dirname, resolve } from 'node:path';

import type { CatalogSandboxInput } from '@suites/blackbox-catalog-internal';
import {
  createNodeRuntimeActivation,
  isNodeRuntimeActivationAdapter,
  type InheritedNodeOptions,
} from '@suites/blackbox-inst-runtime-node';
import type { SandboxTelemetryParticipant } from '@suites/blackbox-sandbox-internal';

import type { CapsuleManagerBootstrap } from '../../protocol.js';

function inheritedNodeOptions(input: {
  readonly plan: CatalogSandboxInput;
  readonly bootstrap: CapsuleManagerBootstrap;
}): InheritedNodeOptions {
  if (Object.hasOwn(input.bootstrap.environment, 'NODE_OPTIONS')) {
    const value = input.bootstrap.environment.NODE_OPTIONS;
    return value.trim() === '' ? { kind: 'absent' } : { kind: 'present', value };
  }
  if (Object.hasOwn(input.plan.environment, 'NODE_OPTIONS')) {
    const value = input.plan.environment.NODE_OPTIONS;
    return value.trim() === '' ? { kind: 'absent' } : { kind: 'present', value };
  }
  return { kind: 'absent' };
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
    const configured = createNodeRuntimeActivation({
      kind: 'node-runtime-activation',
      adapter: activation.adapter,
      bootstrapPath: `${target}/${basename(activation.ref)}`,
      dependencyDirectory: `${target}/node_modules`,
      inheritedNodeOptions: inheritedNodeOptions(input),
    });
    return [
      {
        service: participant.service,
        runtime: participant.runtime,
        environment: configured.environment,
        mounts: [
          {
            source: resolve(input.plan.projectDirectory, dirname(activation.ref)),
            target,
            access: 'read-only',
          },
        ],
      },
    ];
  });
}
