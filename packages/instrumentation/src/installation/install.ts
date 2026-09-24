import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { inspectFiles, writeMissingFiles } from './managed-files.js';
import type {
  InstallInstrumentationInput,
  InstrumentationConflictFailure,
  InstrumentationInstallOperationalFailure,
  InstrumentationInstallResult,
  RuntimeInstrumentationProvider,
} from './model.js';

export const instrumentationDirectoryRelativePath = '.blackbox/instrumentation';

function errorCode(error: unknown): string {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function conflictFailure(
  runtime: string,
  paths: readonly string[],
): InstrumentationConflictFailure {
  return {
    kind: 'instrumentation-install-conflict',
    ok: false,
    runtime,
    paths,
    message: `Refusing to overwrite existing instrumentation files: ${paths.join(', ')}`,
  };
}

function operationalFailure(
  runtime: string,
  directory: string,
  message: string,
): InstrumentationInstallOperationalFailure {
  return {
    kind: 'instrumentation-install-operational-error',
    ok: false,
    runtime,
    directory,
    message,
  };
}

async function installWhileLocked(
  provider: RuntimeInstrumentationProvider,
  directory: string,
): Promise<InstrumentationInstallResult> {
  const inspections = await inspectFiles(directory, provider.files);
  const conflicts = inspections.filter((file) => file.kind === 'conflict').map((file) => file.path);
  if (conflicts.length > 0) {
    return conflictFailure(provider.runtime, conflicts);
  }
  const fileAction = await writeMissingFiles(inspections);
  const preparation = await provider.prepare({ directory });
  if (preparation.kind === 'runtime-preparation-failure') {
    return operationalFailure(provider.runtime, directory, preparation.message);
  }
  return {
    kind: 'instrumentation-install-success',
    ok: true,
    runtime: provider.runtime,
    runtimeDisplayName: provider.displayName,
    directory,
    files: provider.files.map((file) => ({
      kind: 'instrumentation-file',
      path: join(directory, file.name),
    })),
    activation: provider.activation,
    fileAction,
    dependencyAction: preparation.action,
  };
}

async function acquireInstallLock(
  runtime: string,
  lockDirectory: string,
  directory: string,
): Promise<InstrumentationInstallResult | null> {
  try {
    await mkdir(lockDirectory);
    return null;
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') {
      throw error;
    }
    return {
      kind: 'instrumentation-install-busy',
      ok: false,
      runtime,
      directory,
      message: `Another instrumentation installation is in progress: ${directory}`,
    };
  }
}

async function installProvider(
  projectDirectory: string,
  provider: RuntimeInstrumentationProvider,
): Promise<InstrumentationInstallResult> {
  const directory = resolve(projectDirectory, instrumentationDirectoryRelativePath);
  const lockDirectory = join(directory, '.install.lock');
  try {
    await mkdir(directory, { recursive: true });
    const initial = await inspectFiles(directory, provider.files);
    const conflicts = initial.filter((file) => file.kind === 'conflict').map((file) => file.path);
    if (conflicts.length > 0) {
      return conflictFailure(provider.runtime, conflicts);
    }
    const lockFailure = await acquireInstallLock(provider.runtime, lockDirectory, directory);
    if (lockFailure !== null) {
      return lockFailure;
    }
    try {
      return await installWhileLocked(provider, directory);
    } finally {
      await rm(lockDirectory, { recursive: true, force: true });
    }
  } catch (error) {
    return operationalFailure(
      provider.runtime,
      directory,
      `Could not install ${provider.displayName} instrumentation: ${errorMessage(error)}`,
    );
  }
}

export async function installInstrumentation(
  input: InstallInstrumentationInput,
): Promise<InstrumentationInstallResult> {
  const provider = input.providers.find((candidate) => candidate.runtime === input.runtime);
  if (provider === undefined) {
    const supported = input.providers.map((candidate) => candidate.runtime).join(', ');
    return {
      kind: 'unsupported-instrumentation-runtime',
      ok: false,
      runtime: input.runtime,
      message: `Unsupported instrumentation runtime: ${input.runtime}. Supported runtimes: ${supported}.`,
    };
  }
  return await installProvider(input.projectDirectory, provider);
}
