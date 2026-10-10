import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { installDriverRuntime } from '../install-driver-runtime.js';
import { minimumNpmVersion, npmTooOldForFileOverrides } from './npm-version.js';

// What npm 9.2.0 prints for overrides.@suites/blackbox-telemetry=$@suites/blackbox-telemetry
// when that dependency is a local tarball (measured on the train-ticket bench, #111).
const oldNpmStderr =
  'npm ERR! Invalid comparator: file:../../packages/suites-blackbox-telemetry-0.0.1-alpha.0.tgz\n';

it.each([
  ['9.2.0', oldNpmStderr, true],
  ['9.2.0\n', oldNpmStderr, true],
  ['8.19.4', oldNpmStderr, true],
  ['9.3.0', oldNpmStderr, false],
  ['10.9.2', oldNpmStderr, false],
  ['unknown', oldNpmStderr, false],
  [
    '9.2.0',
    'npm ERR! 404 Not Found - GET https://registry.npmjs.org/@suites%2fblackbox-driver\n',
    false,
  ],
])('npm %j with this stderr is too old for file: overrides: %#', (version, stderr, expected) => {
  expect(npmTooOldForFileOverrides({ stderr, version })).toBe(expected);
});

it('names the npm version and the minimum when npm is too old for the driver package', async () => {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'driver-install-old-npm-'));
  try {
    const result = await installDriverRuntime({
      projectDirectory,
      packageManager: () =>
        Promise.resolve({
          kind: 'package-manager-unsupported',
          packageManager: 'npm',
          version: '9.2.0',
          minimumVersion: minimumNpmVersion,
          exitCode: 1,
          stderr: oldNpmStderr,
        }),
    });
    expect(result).toMatchObject({
      kind: 'driver-runtime-installation-failed',
      ok: false,
      failure: {
        kind: 'driver-package-manager-unsupported',
        version: '9.2.0',
        minimumVersion: '9.3.0',
        stderr: oldNpmStderr,
      },
    });
    expect(result.ok ? '' : result.message).toMatch(
      /^npm 9\.2\.0 cannot install .*package\.json: .*Use npm 9\.3\.0 or newer, or remove "overrides"/u,
    );
  } finally {
    await rm(projectDirectory, { recursive: true, force: true });
  }
});
