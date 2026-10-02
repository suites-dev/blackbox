import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';

// The default product, explicit CLI, and adapters this acceptance project uses.
// Internal packages must arrive through their owners' dependency declarations.
export const consumerPackages = [
  '@suites/blackbox',
  '@suites/blackbox-capsule',
  '@suites/blackbox-cli',
  '@suites/blackbox-driver',
  '@suites/blackbox-inst-runtime-node',
  '@suites/blackbox-playwright',
];

export async function verifyConsumerComposition(consumerRoot) {
  const manifest = JSON.parse(await readFile(join(consumerRoot, 'package.json'), 'utf8'));
  const direct = Object.keys(manifest.dependencies ?? {}).sort();
  if (JSON.stringify(direct) !== JSON.stringify(consumerPackages)) {
    throw new Error(
      'Consumer must select the main package, CLI, and adapters, not internal packages',
    );
  }
  const cliEntrypoint = await realpath(
    join(consumerRoot, 'node_modules', '@suites', 'blackbox-cli', 'bin', 'run.js'),
  );
  const executable = await realpath(join(consumerRoot, 'node_modules', '.bin', 'blackbox'));
  if (executable !== cliEntrypoint) {
    throw new Error('Consumer blackbox executable does not belong to @suites/blackbox-cli');
  }
  return { directPackages: direct, cliEntrypoint };
}
