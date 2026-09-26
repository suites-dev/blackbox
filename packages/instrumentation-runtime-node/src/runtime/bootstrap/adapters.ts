import {
  instrumentationDirectoryRelativePath,
  type RuntimeActivationAdapter,
} from '@suites/blackbox-instrumentation-internal';

const targetDirectory = '/blackbox/instrumentation';

export const nodeRuntimeActivationAdapters = [
  {
    kind: 'runtime-activation-adapter',
    runtime: 'node',
    adapter: 'node-preload',
    sourceDirectoryRelativePath: instrumentationDirectoryRelativePath,
    targetDirectory,
    environment: {
      kind: 'append-environment-variable',
      name: 'NODE_OPTIONS',
      separator: ' ',
      value: [{ kind: 'activation-asset-path', prefix: '--require=' }],
    },
  },
  {
    kind: 'runtime-activation-adapter',
    runtime: 'node',
    adapter: 'node-esm',
    sourceDirectoryRelativePath: instrumentationDirectoryRelativePath,
    targetDirectory,
    environment: {
      kind: 'append-environment-variable',
      name: 'NODE_OPTIONS',
      separator: ' ',
      value: [
        {
          kind: 'mounted-relative-path',
          prefix: '--experimental-loader=',
          relativePath: 'node_modules/@opentelemetry/instrumentation/hook.mjs',
        },
        { kind: 'activation-asset-path', prefix: '--require=' },
      ],
    },
  },
] as const satisfies readonly RuntimeActivationAdapter[];
