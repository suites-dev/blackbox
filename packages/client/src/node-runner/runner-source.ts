import type {
  CreateNodeClientInspectorSourceInput,
  CreateNodeClientRunnerSourceInput,
} from './runner-types.js';

function serializeModuleUrl(moduleUrl: URL): string {
  if (moduleUrl.protocol !== 'file:') {
    throw new Error('Client module URL must use the file: protocol');
  }
  return JSON.stringify(moduleUrl.href);
}

export function createNodeClientRunnerSource(
  input: CreateNodeClientRunnerSourceInput,
): string {
  const moduleUrl = serializeModuleUrl(input.clientModuleUrl);
  const runnerUrl = serializeModuleUrl(input.runnerModuleUrl);
  return [
    `import definition from ${moduleUrl};`,
    `import { runNodeClientProcess } from ${runnerUrl};`,
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
  const moduleUrl = serializeModuleUrl(input.clientModuleUrl);
  const runnerUrl = serializeModuleUrl(input.runnerModuleUrl);
  return [
    `import definition from ${moduleUrl};`,
    `import { inspectNodeClientDefinition } from ${runnerUrl};`,
    '',
    'inspectNodeClientDefinition({',
    '  definition,',
    '  output: process.stdout,',
    '});',
    '',
  ].join('\n');
}
