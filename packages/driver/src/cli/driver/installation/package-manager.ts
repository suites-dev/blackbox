import { spawn } from 'node:child_process';

import { npmCommand } from './npm/npm-command.js';
import { minimumNpmVersion, npmTooOldForFileOverrides, readNpmVersion } from './npm/npm-version.js';
import type { PackageManagerInstaller, PackageManagerInstallResult } from './types.js';

/** A failed install, or an unsupported npm when an old npm tripped over a `file:` override. */
async function failedInstall(
  exitCode: number,
  stderr: string,
): Promise<PackageManagerInstallResult> {
  const version = stderr.includes('Invalid comparator') ? await readNpmVersion() : 'unknown';
  if (npmTooOldForFileOverrides({ stderr, version })) {
    return {
      kind: 'package-manager-unsupported',
      packageManager: 'npm',
      version,
      minimumVersion: minimumNpmVersion,
      exitCode,
      stderr,
    };
  }
  return { kind: 'package-manager-install-failed', packageManager: 'npm', exitCode, stderr };
}

function completion(
  resolve: (result: PackageManagerInstallResult) => void,
): (result: PackageManagerInstallResult) => void {
  let completed = false;
  return (result) => {
    if (completed) {
      return;
    }
    completed = true;
    resolve(result);
  };
}

export const installDriverDependencies: PackageManagerInstaller = async ({ directory }) =>
  await new Promise<PackageManagerInstallResult>((resolve) => {
    const complete = completion(resolve);
    const npm = npmCommand([
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
    ]);
    const child = spawn(npm.command, npm.args, {
      cwd: directory,
      env: process.env,
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      complete({
        kind: 'package-manager-install-failed',
        packageManager: 'npm',
        exitCode: 1,
        stderr: error.message,
      });
    });
    child.once('close', (code) => {
      if (code === 0) {
        complete({
          kind: 'package-manager-install-succeeded',
          packageManager: 'npm',
          exitCode: 0,
          stderr,
        });
        return;
      }
      void failedInstall(code ?? 1, stderr).then(complete);
    });
  });
