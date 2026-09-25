import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  ensureDriverPackage,
  ensureDriverRuntimeArtifact,
  DriverPackageFileError,
} from './package-files.js';
import { resolveInstalledDriverSdk } from './resolution.js';
import {
  driverSdkPackageName,
  type DriverRuntimeInstallationFailure,
  type DriverRuntimeInstallationResult,
  type InstallDriverRuntimeInput,
} from './types.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failed(
  directory: string,
  failure: DriverRuntimeInstallationFailure,
  message: string,
): DriverRuntimeInstallationResult {
  return {
    kind: 'driver-runtime-installation-failed',
    ok: false,
    runtime: 'node',
    directory,
    failure,
    message,
  };
}

async function acquireLock(
  directory: string,
  lockDirectory: string,
): Promise<DriverRuntimeInstallationResult | null> {
  try {
    await mkdir(lockDirectory);
    return null;
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
      throw error;
    }
    return failed(
      directory,
      { kind: 'driver-installation-in-progress', lockDirectory },
      `Another driver installation is in progress: ${directory}`,
    );
  }
}

async function installLocked(
  directory: string,
  input: InstallDriverRuntimeInput,
): Promise<DriverRuntimeInstallationResult> {
  const packagePath = join(directory, 'package.json');
  const runtimePath = join(directory, 'blackbox-driver-runtime.json');
  let packageFile;
  let runtimeFile;
  try {
    packageFile = await ensureDriverPackage(packagePath);
    runtimeFile = await ensureDriverRuntimeArtifact(runtimePath);
  } catch (error) {
    if (error instanceof DriverPackageFileError) {
      return failed(
        directory,
        { kind: error.kind, path: error.path, reason: error.message },
        error.message,
      );
    }
    throw error;
  }
  const installation = await input.packageManager({ directory });
  if (installation.kind === 'package-manager-install-failed') {
    return failed(
      directory,
      {
        kind: 'driver-package-manager-failed',
        packageManager: installation.packageManager,
        exitCode: installation.exitCode,
        stderr: installation.stderr,
      },
      `Could not install ${driverSdkPackageName}: ${installation.stderr || `npm exited ${installation.exitCode}`}`,
    );
  }
  try {
    const resolved = await resolveInstalledDriverSdk(directory);
    return {
      kind: 'driver-runtime-installation-succeeded',
      ok: true,
      runtime: 'node',
      directory,
      files: {
        kind: 'driver-runtime-files',
        package: packageFile.action,
        runtime: runtimeFile,
      },
      dependency: {
        kind: 'driver-sdk-installed',
        packageName: driverSdkPackageName,
        spec: packageFile.spec,
        installationPath: resolved.installationPath,
        entrypoint: resolved.entrypoint,
      },
    };
  } catch (error) {
    const reason = errorMessage(error);
    return failed(
      directory,
      { kind: 'driver-sdk-unresolved', packageName: driverSdkPackageName, reason },
      `${driverSdkPackageName} did not resolve from ${directory}: ${reason}`,
    );
  }
}

export async function installDriverRuntime(
  input: InstallDriverRuntimeInput,
): Promise<DriverRuntimeInstallationResult> {
  const directory = resolve(input.projectDirectory, '.blackbox', 'drivers');
  const lockDirectory = join(directory, '.install.lock');
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const lockFailure = await acquireLock(directory, lockDirectory);
    if (lockFailure !== null) {
      return lockFailure;
    }
    try {
      return await installLocked(directory, input);
    } finally {
      await rm(lockDirectory, { recursive: true, force: true });
    }
  } catch (error) {
    const reason = errorMessage(error);
    return failed(
      directory,
      { kind: 'driver-installation-operational-failure', reason },
      `Could not install the Node driver runtime: ${reason}`,
    );
  }
}
