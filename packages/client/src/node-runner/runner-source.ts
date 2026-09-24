import type { CreateNodeClientRunnerSourceInput } from './runner-types.js';

export function createNodeClientRunnerSource(
  input: CreateNodeClientRunnerSourceInput,
): string {
  if (input.clientModuleUrl.protocol !== 'file:') {
    throw new Error('Client module URL must use the file: protocol');
  }
  const moduleUrl = JSON.stringify(input.clientModuleUrl.href);
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
