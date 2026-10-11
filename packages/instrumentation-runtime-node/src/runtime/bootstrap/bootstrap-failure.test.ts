import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { nodeInstrumentationSource } from './bundle.js';

it('fails the application start loudly when runtime dependencies are unavailable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-bootstrap-failure-'));
  const bootstrap = join(directory, 'instrumentation.js');
  try {
    await writeFile(bootstrap, nodeInstrumentationSource);
    const result = spawnSync(process.execPath, ['--require', bootstrap, '--eval', 'void 0'], {
      cwd: directory,
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Cannot find module '@opentelemetry/sdk-node'");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const launcherEntries = [
  'lib/node_modules/npm/bin/npm-cli.js',
  'lib/node_modules/npm/bin/npx-cli.js',
  'lib/node_modules/pnpm/bin/pnpm.cjs',
  'lib/node_modules/pnpm/bin/pnpx.cjs',
  'lib/node_modules/yarn/bin/yarn.js',
  'lib/node_modules/@yarnpkg/cli-dist/bin/yarn.js',
  'lib/node_modules/corepack/dist/corepack.js',
  'lib/node_modules/corepack/dist/npm.js',
  'lib/node_modules/corepack/dist/npx.js',
  'lib/node_modules/corepack/dist/pnpm.js',
  'lib/node_modules/corepack/dist/pnpx.js',
  'lib/node_modules/corepack/dist/yarn.js',
  'lib/node_modules/corepack/dist/yarnpkg.js',
  'project/.yarn/releases/yarn-4.9.1.cjs',
];

const applicationEntries = [
  'project/server.js',
  'npm/server.js',
  'project/npm-cli.js',
  'project/bin/npm-cli.js',
  'project/node_modules/npm-run-all/bin/npm-run-all/index.js',
  'project/node_modules/my-npm/bin/npm-cli.js',
  'project/.yarn/releases/server.cjs',
];

let directory: string;
let bootstrap: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'blackbox-package-manager-launcher-'));
  bootstrap = join(directory, 'instrumentation.js');
  await writeFile(bootstrap, nodeInstrumentationSource);
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function writeEntry(relativePath: string): Promise<string> {
  const entry = join(directory, relativePath);
  await mkdir(dirname(entry), { recursive: true });
  await writeFile(entry, "process.stdout.write('entry ran');\n");
  return entry;
}

// The bootstrap's OpenTelemetry dependencies are absent here, so an entry the bootstrap
// instruments fails on the first SDK require, while a skipped launcher runs its own code.
function runWithBootstrap(entry: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ['--require', bootstrap, entry], {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '' },
  });
}

describe('package-manager launchers', () => {
  it.each(launcherEntries)('skips the SDK for %s', async (relativePath) => {
    const result = runWithBootstrap(await writeEntry(relativePath));
    expect(result.status, String(result.stderr)).toBe(0);
    expect(result.stdout).toBe('entry ran');
  });

  it('skips a launcher started through a symlinked bin', async () => {
    const entry = await writeEntry('lib/node_modules/npm/bin/npm-cli.js');
    const bin = join(directory, 'bin', 'npm');
    await mkdir(dirname(bin), { recursive: true });
    await symlink(entry, bin);
    const result = runWithBootstrap(bin);
    expect(result.status, String(result.stderr)).toBe(0);
    expect(result.stdout).toBe('entry ran');
  });

  it.each(applicationEntries)('instruments %s', async (relativePath) => {
    const result = runWithBootstrap(await writeEntry(relativePath));
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain("Cannot find module '@opentelemetry/sdk-node'");
  });
});
