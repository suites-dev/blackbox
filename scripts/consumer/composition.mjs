import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';

// The default product plus the adapters this acceptance project actually uses.
// Internal packages must arrive through their owners' dependency declarations.
export const consumerPackages = [
  '@suites/blackbox',
  '@suites/blackbox-capsule',
  '@suites/blackbox-driver',
  '@suites/blackbox-inst-runtime-node',
  '@suites/blackbox-playwright',
];

export async function verifyConsumerComposition(consumerRoot) {
  const manifest = JSON.parse(await readFile(join(consumerRoot, 'package.json'), 'utf8'));
  const direct = Object.keys(manifest.dependencies ?? {}).sort();
  if (JSON.stringify(direct) !== JSON.stringify(consumerPackages)) {
    throw new Error(
      'Consumer must select the main package and its adapters, not internal packages',
    );
  }
  const mainEntrypoint = await realpath(
    join(consumerRoot, 'node_modules', '@suites', 'blackbox', 'bin', 'run.js'),
  );
  const executable = await realpath(join(consumerRoot, 'node_modules', '.bin', 'blackbox'));
  if (executable !== mainEntrypoint) {
    throw new Error('Consumer blackbox executable does not belong to @suites/blackbox');
  }
  return { directPackages: direct, mainEntrypoint };
}
