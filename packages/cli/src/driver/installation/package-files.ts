import { readFile, writeFile } from 'node:fs/promises';

import {
  decodeDriverRuntimeArtifact,
  DriverRuntimeArtifactError,
  nodeDriverRuntimeArtifact,
} from '@suites/blackbox-driver';

import {
  defaultDriverSdkSpec,
  driverSdkPackageName,
  type DriverRuntimeFileAction,
} from './types.js';

export class DriverPackageFileError extends Error {
  constructor(
    readonly kind: 'driver-package-invalid' | 'driver-runtime-artifact-invalid',
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = 'DriverPackageFileError';
  }
}

function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function objectRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DriverPackageFileError(
      'driver-package-invalid',
      path,
      `Driver package must contain a JSON object: ${path}`,
    );
  }
  return value as Record<string, unknown>;
}

function dependencyRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DriverPackageFileError(
      'driver-package-invalid',
      path,
      `Driver package dependencies must contain a JSON object: ${path}`,
    );
  }
  return value as Record<string, unknown>;
}

function packageSource(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function ensureDriverPackage(path: string): Promise<{
  readonly kind: 'driver-package-ready';
  readonly action: DriverRuntimeFileAction;
  readonly spec: string;
}> {
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    if (!missing(error)) {
      throw error;
    }
    const document = {
      name: 'blackbox-project-drivers',
      version: '1.0.0',
      private: true,
      type: 'module',
      dependencies: { [driverSdkPackageName]: defaultDriverSdkSpec },
    };
    await writeFile(path, packageSource(document), { flag: 'wx', mode: 0o600 });
    return { kind: 'driver-package-ready', action: 'created', spec: defaultDriverSdkSpec };
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(source) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new DriverPackageFileError('driver-package-invalid', path, reason);
  }
  const current = objectRecord(decoded, path);
  const dependencies = dependencyRecord(current.dependencies, path);
  const existing = dependencies[driverSdkPackageName];
  if (typeof existing === 'string' && existing.length > 0) {
    return { kind: 'driver-package-ready', action: 'retained', spec: existing };
  }
  if (existing !== undefined) {
    throw new DriverPackageFileError(
      'driver-package-invalid',
      path,
      `${driverSdkPackageName} must be a non-empty package spec`,
    );
  }
  const updated = {
    ...current,
    dependencies: { ...dependencies, [driverSdkPackageName]: defaultDriverSdkSpec },
  };
  await writeFile(path, packageSource(updated), { mode: 0o600 });
  return { kind: 'driver-package-ready', action: 'updated', spec: defaultDriverSdkSpec };
}

export async function ensureDriverRuntimeArtifact(path: string): Promise<DriverRuntimeFileAction> {
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    if (!missing(error)) {
      throw error;
    }
    await writeFile(path, packageSource(nodeDriverRuntimeArtifact), { flag: 'wx', mode: 0o600 });
    return 'created';
  }
  try {
    decodeDriverRuntimeArtifact(source);
    return 'retained';
  } catch (error) {
    const reason =
      error instanceof DriverRuntimeArtifactError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    throw new DriverPackageFileError('driver-runtime-artifact-invalid', path, reason);
  }
}
