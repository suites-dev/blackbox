import { isAbsolute, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import type { DriverPrepareRequest } from '../../model/driver-context.js';
import type { DriverPrepareResponse } from '../../model/preparation.js';
import { decodeDriverPrepareResponse } from '../../protocol/decode.js';
import { validateDriverPreparation } from '../../protocol/preparation-validation.js';
import { runProjectDriverProcess } from '../runtime/project-driver-process.js';
import { createNodeDriverRunnerSource } from '../runtime/runner-source.js';

export interface PrepareNodeProjectDriverInput {
  readonly driverModulePath: string;
  readonly projectDirectory: string;
  readonly request: DriverPrepareRequest;
}

const require = createRequire(import.meta.url);

function absolutePath(path: string, label: string): string {
  if (!isAbsolute(path)) {
    throw new Error(`${label} must be an absolute path`);
  }
  return resolve(path);
}

export async function prepareNodeProjectDriver(
  input: PrepareNodeProjectDriverInput,
): Promise<DriverPrepareResponse> {
  const driverModuleUrl = pathToFileURL(absolutePath(input.driverModulePath, 'Driver module path'));
  const projectDirectory = absolutePath(input.projectDirectory, 'Project directory');
  const source = createNodeDriverRunnerSource({
    driverModuleUrl,
    runnerModuleUrl: pathToFileURL(require.resolve('@suites/blackbox-driver/node-runner')),
  });
  const output = await runProjectDriverProcess({
    source,
    projectDirectory,
    requestJson: JSON.stringify(input.request),
  });
  const response = decodeDriverPrepareResponse(output.stdout.trim());
  if (response.kind === 'driver-prepare-succeeded') {
    validateDriverPreparation({ request: input.request, preparation: response.preparation });
  }
  return response;
}
