export type NodeRuntimeActivationAdapter = 'node-preload' | 'node-esm';

export type InheritedNodeOptions =
  | { readonly kind: 'absent' }
  | { readonly kind: 'present'; readonly value: string };

export interface NodeRuntimeActivationInput {
  readonly kind: 'node-runtime-activation';
  readonly adapter: NodeRuntimeActivationAdapter;
  readonly bootstrapPath: string;
  readonly dependencyDirectory: string;
  readonly inheritedNodeOptions: InheritedNodeOptions;
}

export interface NodeRuntimeActivation {
  readonly kind: 'node-runtime-activation-environment';
  readonly adapter: NodeRuntimeActivationAdapter;
  readonly environment: { readonly NODE_OPTIONS: string };
}

function activationOptions(input: NodeRuntimeActivationInput): readonly string[] {
  if (input.adapter === 'node-preload') {
    return [`--require=${input.bootstrapPath}`];
  }
  const hook = `${input.dependencyDirectory}/@opentelemetry/instrumentation/hook.mjs`;
  return [`--experimental-loader=${hook}`, `--require=${input.bootstrapPath}`];
}

export function createNodeRuntimeActivation(
  input: NodeRuntimeActivationInput,
): NodeRuntimeActivation {
  const configured = activationOptions(input).join(' ');
  const nodeOptions =
    input.inheritedNodeOptions.kind === 'present'
      ? `${input.inheritedNodeOptions.value.trim()} ${configured}`.trim()
      : configured;
  return {
    kind: 'node-runtime-activation-environment',
    adapter: input.adapter,
    environment: { NODE_OPTIONS: nodeOptions },
  };
}

export function isNodeRuntimeActivationAdapter(
  value: string,
): value is NodeRuntimeActivationAdapter {
  return value === 'node-preload' || value === 'node-esm';
}
