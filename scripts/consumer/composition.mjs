import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';

// The default product, explicit CLI, and adapters this acceptance project uses.
// Internal packages must arrive through their owners' dependency declarations.
export const consumerPackages = [
  '@suites/blackbox',
  '@suites/blackbox-capsule',
  '@suites/blackbox-cli',
  '@suites/blackbox-driver',
  '@suites/blackbox-effects',
  '@suites/blackbox-feature',
  '@suites/blackbox-inst-runtime-node',
  '@suites/blackbox-playwright',
];

/** The runner is a consumer dependency, separate from the selected Blackbox adapters. */
export async function consumerRunnerDependency() {
  const manifest = JSON.parse(
    await readFile(new URL('../../e2e/package.json', import.meta.url), 'utf8'),
  );
  const version = manifest.dependencies?.['@playwright/test'];
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new Error('The E2E Playwright runner must have an exact version');
  }
  return { '@playwright/test': version };
}

export async function verifyConsumerComposition(consumerRootValue) {
  const consumerRoot = await realpath(consumerRootValue);
  const manifest = JSON.parse(await readFile(join(consumerRoot, 'package.json'), 'utf8'));
  const runnerDependency = await consumerRunnerDependency();
  const version = runnerDependency['@playwright/test'];
  if (manifest.dependencies?.['@playwright/test'] !== version) {
    throw new Error(`Consumer must pin its Playwright runner to ${version}`);
  }
  const direct = Object.keys(manifest.dependencies ?? {}).sort();
  if (JSON.stringify(direct) !== JSON.stringify(['@playwright/test', ...consumerPackages].sort())) {
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
  const packageRoot = await realpath(join(consumerRoot, 'node_modules', '@playwright', 'test'));
  const difference = relative(consumerRoot, packageRoot);
  if (difference.startsWith('..') || isAbsolute(difference)) {
    throw new Error('Playwright runner escaped the independent consumer');
  }
  const installed = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  if (installed.name !== '@playwright/test' || installed.version !== version) {
    throw new Error('Installed Playwright runner does not match the exact consumer pin');
  }
  return {
    directPackages: direct.filter((name) => name !== '@playwright/test'),
    runner: { name: '@playwright/test', version, packageRoot },
    cliEntrypoint,
  };
}
