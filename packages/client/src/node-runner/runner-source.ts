import type {
  CreateNodeClientInspectorSourceInput,
  CreateNodeClientRunnerSourceInput,
} from './runner-types.js';

function serializeClientModuleUrl(clientModuleUrl: URL): string {
  if (clientModuleUrl.protocol !== 'file:') {
    throw new Error('Client module URL must use the file: protocol');
  }
  return JSON.stringify(clientModuleUrl.href);
}

export function createNodeClientRunnerSource(
  input: CreateNodeClientRunnerSourceInput,
): string {
  const moduleUrl = serializeClientModuleUrl(input.clientModuleUrl);
  return [
    `import definition from ${moduleUrl};`,
    `import { runNodeClientProcess } from '@suites/blackbox-client/node-runner';`,
    '',
    'await runNodeClientProcess({',
    '  definition,',
    '  input: process.stdin,',
    '  output: process.stdout,',
    '});',
    '',
  ].join('\n');
}

export function createNodeClientInspectorSource(
  input: CreateNodeClientInspectorSourceInput,
): string {
  const moduleUrl = serializeClientModuleUrl(input.clientModuleUrl);
  return [
    `import definition from ${moduleUrl};`,
    `import { inspectNodeClientDefinition } from '@suites/blackbox-client/node-runner';`,
    '',
    'inspectNodeClientDefinition({',
    '  definition,',
    '  output: process.stdout,',
    '});',
    '',
  ].join('\n');
}
