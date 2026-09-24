import { access, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import type { RuntimePreparationResult } from '@suites/blackbox-instrumentation-internal';

import type { NodeDependencyInstaller } from './dependency-installer.js';
import { nodeInstrumentationDependencies } from '../bootstrap/bundle.js';

export interface PrepareNodeDependenciesInput {
  readonly directory: string;
  readonly dependencyInstaller: NodeDependencyInstaller;
}

function packageVersion(document: unknown): string {
  if (
    typeof document === 'object' &&
    document !== null &&
    'version' in document &&
    typeof document.version === 'string'
  ) {
    return document.version;
  }
  return '';
}

async function dependencyIsCurrent(
  directory: string,
  packageName: string,
  expectedVersion: string,
): Promise<boolean> {
  try {
    const packageFile = join(directory, 'node_modules', ...packageName.split('/'), 'package.json');
    const document: unknown = JSON.parse(await readFile(packageFile, 'utf8'));
    if (packageVersion(document) !== expectedVersion) {
      return false;
    }
    const entryFile = createRequire(join(directory, 'package.json')).resolve(packageName);
    await access(entryFile);
    return true;
  } catch {
    return false;
  }
}

async function dependenciesAreCurrent(directory: string): Promise<boolean> {
  const checks = await Promise.all(
    Object.entries(nodeInstrumentationDependencies).map(
      async ([name, version]) => await dependencyIsCurrent(directory, name, version),
    ),
  );
  return checks.every(Boolean);
}

export async function prepareNodeDependencies(
  input: PrepareNodeDependenciesInput,
): Promise<RuntimePreparationResult> {
  if (await dependenciesAreCurrent(input.directory)) {
    return { kind: 'runtime-preparation-success', action: 'unchanged' };
  }
  const result = await input.dependencyInstaller({ directory: input.directory });
  if (result.kind === 'dependency-install-failure') {
    const detail = result.stderr.trim();
    const suffix = detail === '' ? '.' : `: ${detail}`;
    return {
      kind: 'runtime-preparation-failure',
      message: `Could not install OpenTelemetry dependencies (exit ${result.exitCode})${suffix}`,
    };
  }
  if (!(await dependenciesAreCurrent(input.directory))) {
    return {
      kind: 'runtime-preparation-failure',
      message:
        'The dependency installer completed without installing the pinned OpenTelemetry packages.',
    };
  }
  return { kind: 'runtime-preparation-success', action: 'installed' };
}
