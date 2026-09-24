import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createNodeClientInspectorSource,
  createNodeClientRunnerSource,
} from '@suites/blackbox-client';
import type { ResolvedCatalogClient } from '@suites/blackbox-catalog-internal';

import { capsuleSessionDirectory } from '../records.js';

export async function writeClientRunners(input: {
  readonly projectDirectory: string;
  readonly sessionId: string;
  readonly activityId: string;
  readonly client: ResolvedCatalogClient;
}): Promise<{ readonly inspect: string; readonly execute: string }> {
  const directory = resolve(
    capsuleSessionDirectory(input),
    'client-runtime',
    input.activityId,
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const moduleUrl = pathToFileURL(resolve(input.projectDirectory, input.client.ref));
  const runnerModuleUrl = pathToFileURL(
    createRequire(import.meta.url).resolve('@suites/blackbox-client/node-runner'),
  );
  const inspect = resolve(directory, 'inspect.mjs');
  const execute = resolve(directory, 'execute.mjs');
  await Promise.all([
    writeFile(inspect, createNodeClientInspectorSource({
      clientModuleUrl: moduleUrl,
      runnerModuleUrl,
    }), {
      mode: 0o600,
    }),
    writeFile(execute, createNodeClientRunnerSource({
      clientModuleUrl: moduleUrl,
      runnerModuleUrl,
    }), {
      mode: 0o600,
    }),
  ]);
  return { inspect, execute };
}
