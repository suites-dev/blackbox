import type { CreateNodeDriverRunnerSourceInput } from './runner-types.js';

function serializeModuleUrl(moduleUrl: URL): string {
  if (moduleUrl.protocol !== 'file:') {
    throw new Error('Driver module URL must use the file: protocol');
  }
  return JSON.stringify(moduleUrl.href);
}

export function createNodeDriverRunnerSource(
  input: CreateNodeDriverRunnerSourceInput,
): string {
  const driverUrl = serializeModuleUrl(input.driverModuleUrl);
  const runnerUrl = serializeModuleUrl(input.runnerModuleUrl);
  return [
    `import definition from ${driverUrl};`,
    `import { runNodeDriverProcess } from ${runnerUrl};`,
    '',
    'await runNodeDriverProcess({',
    '  definition,',
    '  input: process.stdin,',
    '  output: process.stdout,',
    '});',
    '',
  ].join('\n');
}
