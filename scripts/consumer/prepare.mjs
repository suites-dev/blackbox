// Install the published Blackbox packages into a throwaway consumer outside the
// workspace, then point the project's drivers at that same installation.
//
// The demo and the CLI journeys both run against this consumer, so every
// command they exercise resolves the way a user's would: from a registry,
// out of a package tarball, with no path back into packages/*/src.
//
// Nothing here builds and nothing here packs. Build the workspace and publish
// it to the registry first; this fails if the registry does not serve the
// version recorded in lerna.json.

import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { cleanupCapsuleAssets, verifyCapsuleAssetBoundary } from './capsule-asset-boundary.mjs';
import { resetCapsuleDemo } from './capsule-reset.mjs';
import { consumerPackages, verifyConsumerComposition } from './composition.mjs';

const execute = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptDirectory, '..', '..');
// The consumer is shared: the demo and the CLI journeys prepare it against the
// same project, and e2e is the only one in this repository.
const projectRoot = join(workspaceRoot, 'e2e');
const registry = process.env.BLACKBOX_TEST_REGISTRY ?? 'http://127.0.0.1:4874/';

const projectDrivers = ['public-api.mjs', 'postgres.mjs', 'redis.mjs'];

async function publicPackageNames() {
  const packagesRoot = join(workspaceRoot, 'packages');
  const names = [];
  for (const entry of await readdir(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(packagesRoot, entry.name, 'package.json');
    let manifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (manifest.private === true) continue;
    names.push(manifest.name);
  }
  return names.sort();
}

async function readVersion() {
  const lerna = JSON.parse(await readFile(join(workspaceRoot, 'lerna.json'), 'utf8'));
  if (typeof lerna.version !== 'string' || lerna.version.length === 0) {
    throw new Error('lerna.json does not record a version');
  }
  return lerna.version;
}

async function installConsumer(input) {
  const manifest = {
    name: 'blackbox-registry-consumer',
    private: true,
    type: 'module',
    dependencies: Object.fromEntries(consumerPackages.map((name) => [name, input.version])),
  };
  await writeFile(join(input.consumerRoot, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await execute(
    'npm',
    [
      'install',
      '--prefix',
      input.consumerRoot,
      '--registry',
      registry,
      '--cache',
      input.npmCache,
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--loglevel',
      'warn',
    ],
    { cwd: input.consumerRoot },
  );
}

// `driver install` creates the driver package when it is absent and retains a
// declaration it already finds. Both drivers and the telemetry package are
// declared here because the project-authored drivers import both directly.
async function installDrivers(input) {
  await writeFile(
    join(input.driverDirectory, 'package.json'),
    `${JSON.stringify(
      {
        name: 'blackbox-project-drivers',
        version: '1.0.0',
        private: true,
        type: 'module',
        dependencies: {
          '@suites/blackbox-driver': input.version,
          '@suites/blackbox-telemetry': input.version,
          '@suites/blackbox-cli-contract': input.version,
        },
      },
      null,
      2,
    )}\n`,
  );
  const environment = {
    ...process.env,
    NPM_CONFIG_REGISTRY: registry,
    NPM_CONFIG_CACHE: input.npmCache,
  };
  const run = async () => {
    const result = await execute(
      input.blackboxBin,
      ['driver', 'install', '--runtime', 'node', '--json'],
      { cwd: projectRoot, env: environment },
    );
    return JSON.parse(result.stdout);
  };

  const first = await run();
  if (
    first.kind !== 'driver-runtime-installation-succeeded' ||
    first.ok !== true ||
    first.dependency.kind !== 'driver-sdk-installed' ||
    first.dependency.spec !== input.version
  ) {
    throw new Error(
      `Driver SDK installation did not report success pinned to ${input.version}: ${JSON.stringify(first)}`,
    );
  }
  // Repeated installation must retain the project-owned package contract and
  // keep the published Driver SDK resolvable without workspace imports.
  const second = await run();
  if (
    second.kind !== 'driver-runtime-installation-succeeded' ||
    second.files.package !== 'retained' ||
    second.files.runtime !== 'retained' ||
    second.dependency.kind !== 'driver-sdk-installed'
  ) {
    throw new Error('Repeated driver installation did not retain the project-owned files');
  }
  return { first, second };
}

async function main() {
  const version = await readVersion();
  const packages = await publicPackageNames();
  const driverDirectory = join(projectRoot, '.blackbox', 'drivers');
  const artifactRoot = join(projectRoot, '.blackbox', 'tmp', 'capsule-assets');
  const statePath = join(projectRoot, '.blackbox', 'capsule-assets.json');

  for (const driver of projectDrivers) {
    await readFile(join(driverDirectory, driver));
  }

  // A killed earlier run can leave its consumer behind. Cleanup accepts the
  // state file only when it proves the path belongs to this test.
  await cleanupCapsuleAssets();

  const assetRoot = await mkdtemp(join(tmpdir(), 'blackbox-capsule-assets.'));
  const consumerRoot = join(assetRoot, 'consumer');
  const npmCache = join(assetRoot, 'npm-cache');
  let ready = false;
  try {
    await mkdir(consumerRoot, { recursive: true });
    await mkdir(npmCache, { recursive: true });
    process.stdout.write(`[blackbox] Installing the main package and ${consumerPackages.length - 1} adapters from ${registry}\n`);
    await installConsumer({ consumerRoot, npmCache, version });

    const blackboxBin = join(consumerRoot, 'node_modules', '.bin', 'blackbox');
    const { mainEntrypoint: entrypoint } = await verifyConsumerComposition(consumerRoot);

    // Reset before installing generated assets: reset deliberately removes
    // generated driver state. Live sessions stop through the published CLI.
    await resetCapsuleDemo({
      projectDirectory: projectRoot,
      stopSession: async ({ sessionId }) => {
        process.stdout.write(`[blackbox] Stopping previous Capsule ${sessionId}\n`);
        const result = await execute(
          process.execPath,
          [entrypoint, 'capsule', 'down', sessionId, '--json'],
          { cwd: projectRoot },
        );
        const outcome = JSON.parse(result.stdout);
        if (outcome.kind !== 'capsule-stopped' || outcome.cleanup !== 'complete') {
          throw new Error(`Cleanup was not confirmed for ${sessionId}`);
        }
      },
    });

    // The reset removes generated instrumentation, and those two files are
    // tracked. Reinstalling them here keeps preparation self-consistent: a run
    // that stops before any lane still leaves the checkout as it found it.
    await execute(blackboxBin, ['inst', 'install', '--runtime', 'node'], {
      cwd: projectRoot,
      env: { ...process.env, NPM_CONFIG_REGISTRY: registry, NPM_CONFIG_CACHE: npmCache },
    });

    await mkdir(artifactRoot, { recursive: true });
    await mkdir(driverDirectory, { recursive: true });
    const driverInstall = await installDrivers({
      blackboxBin,
      driverDirectory,
      npmCache,
      version,
    });
    await writeFile(
      join(artifactRoot, 'driver-install.json'),
      `${JSON.stringify(driverInstall, null, 2)}\n`,
    );

    await writeFile(
      statePath,
      `${JSON.stringify({ assetRoot, consumerRoot, blackboxBin, driverDirectory, packages }, null, 2)}\n`,
    );
    await chmod(statePath, 0o600);

    await writeFile(
      join(artifactRoot, 'package-boundary.json'),
      `${JSON.stringify(await verifyCapsuleAssetBoundary(), null, 2)}\n`,
    );
    await execute(blackboxBin, ['--help'], { env: { ...process.env, NODE_OPTIONS: '' } });

    await writeFile(
      join(artifactRoot, 'receipt.txt'),
      [
        `registry=${registry}`,
        `version=${version}`,
        `packages=${packages.length}`,
        `direct-packages=${consumerPackages.join(',')}`,
        `consumer=${consumerRoot}`,
        `blackbox-bin=${blackboxBin}`,
        'project-drivers=validated',
        'driver-sdk=published-project-local',
        'workspace-imports=absent',
        '',
      ].join('\n'),
    );
    ready = true;
    process.stdout.write(`[blackbox] Consumer ready: ${consumerRoot}\n`);
    process.stdout.write(`[blackbox] Artifacts: ${artifactRoot}\n`);
  } finally {
    if (!ready) {
      await rm(assetRoot, { recursive: true, force: true });
    }
  }
}

await main();
