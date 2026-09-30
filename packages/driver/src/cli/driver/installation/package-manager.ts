import { spawn } from 'node:child_process';

import type { PackageManagerInstaller, PackageManagerInstallResult } from './types.js';

function npmCommand(args: readonly string[]): { command: string; args: readonly string[] } {
  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args,
  };
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
      complete(
        code === 0
          ? {
              kind: 'package-manager-install-succeeded',
              packageManager: 'npm',
              exitCode: 0,
              stderr,
            }
          : {
              kind: 'package-manager-install-failed',
              packageManager: 'npm',
              exitCode: code ?? 1,
              stderr,
            },
      );
    });
  });
