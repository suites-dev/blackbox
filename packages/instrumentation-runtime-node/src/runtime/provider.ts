import type {
  RuntimeInstrumentationProvider,
  RuntimeInstrumentationFile,
} from '@suites/blackbox-instrumentation-internal';

import { installNodeDependencies, type NodeDependencyInstaller } from './dependency-installer.js';
import { prepareNodeDependencies } from './dependency-state.js';
import { nodeInstrumentationFiles } from './bundle.js';

export interface CreateNodeRuntimeProviderInput {
  readonly dependencyInstaller: NodeDependencyInstaller;
}

const files: readonly RuntimeInstrumentationFile[] = nodeInstrumentationFiles.map((file) => ({
  kind: 'runtime-instrumentation-file',
  name: file.name,
  content: file.content,
}));

export function createNodeRuntimeProvider(
  input: CreateNodeRuntimeProviderInput,
): RuntimeInstrumentationProvider {
  return {
    kind: 'runtime-instrumentation-provider',
    runtime: 'node',
    displayName: 'Node',
    files,
    activation: [
      {
        kind: 'runtime-activation-instruction',
        description: 'Load it when starting a CommonJS application:',
        command: 'node --require ./.blackbox/instrumentation/instrumentation.js <application.cjs>',
      },
      {
        kind: 'runtime-activation-instruction',
        description: 'Load it when starting an ES module application:',
        command:
          'node --experimental-loader=./.blackbox/instrumentation/node_modules/@opentelemetry/instrumentation/hook.mjs --import ./.blackbox/instrumentation/instrumentation.js <application.mjs>',
      },
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
