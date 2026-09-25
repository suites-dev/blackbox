import type {
  RuntimeInstrumentationProvider,
  RuntimeInstrumentationFile,
} from '@suites/blackbox-instrumentation-internal';

import {
  installNodeDependencies,
  type NodeDependencyInstaller,
} from '../dependencies/dependency-installer.js';
import { prepareNodeDependencies } from '../dependencies/dependency-state.js';
import { createNodeRuntimeActivation } from './activation.js';
import { nodeInstrumentationFiles } from './bundle.js';

export interface CreateNodeRuntimeProviderInput {
  readonly dependencyInstaller: NodeDependencyInstaller;
}

const files: readonly RuntimeInstrumentationFile[] = nodeInstrumentationFiles.map((file) => ({
  kind: 'runtime-instrumentation-file',
  name: file.name,
  content: file.content,
}));

function activationInstruction(input: {
  readonly adapter: 'node-preload' | 'node-esm';
  readonly application: '<application.cjs>' | '<application.mjs>';
  readonly description: string;
}): RuntimeInstrumentationProvider['activation'][number] {
  const activation = createNodeRuntimeActivation({
    kind: 'node-runtime-activation',
    adapter: input.adapter,
    bootstrapPath: './.blackbox/instrumentation/instrumentation.js',
    dependencyDirectory: './.blackbox/instrumentation/node_modules',
    inheritedNodeOptions: { kind: 'absent' },
  });
  return {
    kind: 'runtime-activation-instruction',
    description: input.description,
    command: `NODE_OPTIONS=${JSON.stringify(activation.environment.NODE_OPTIONS)} node ${input.application}`,
  };
}

export function createNodeRuntimeProvider(
  input: CreateNodeRuntimeProviderInput,
): RuntimeInstrumentationProvider {
  return {
    kind: 'runtime-instrumentation-provider',
    runtime: 'node',
    displayName: 'Node',
    files,
    activation: [
      activationInstruction({
        adapter: 'node-preload',
        application: '<application.cjs>',
        description: 'Load it when starting a CommonJS application:',
      }),
      activationInstruction({
        adapter: 'node-esm',
        application: '<application.mjs>',
        description: 'Load it when starting an ES module application:',
      }),
    ],
    prepare: async ({ directory }) =>
      await prepareNodeDependencies({
        directory,
        dependencyInstaller: input.dependencyInstaller,
      }),
  };
}

export const nodeRuntimeProvider = createNodeRuntimeProvider({
  dependencyInstaller: installNodeDependencies,
});
