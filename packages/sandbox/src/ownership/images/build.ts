import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import dockerCompose from 'docker-compose';

import type { ComposeStartRequest } from '../../model/compose.js';
import { composeOptions } from '../../acquisition/environment/options.js';
import { observedInventory, removeRecordedImages, requireUnusedTags, type BuildImageDocker } from './docker.js';
import { writeInventory, ownerLabel, planInventory, serviceLabel, type BuildInventory } from './inventory.js';

async function buildServices(request: ComposeStartRequest): Promise<string[]> {
  const options = composeOptions(request, []);
  // Include profiled services in the ownership overlay. Compose still applies the caller's
  // selection and active profiles when building, inspecting, and starting the project.
  let services: Record<string, string | Record<string, string>>;
  try {
    const { data } = await dockerCompose.config({
      ...options, composeOptions: ['--project-name', request.projectName, '--profile', '*'],
    });
    services = data.config.services;
  } catch {
    // Config output can include interpolated secrets.
    throw new Error('Could not resolve Compose services for Sandbox image ownership');
  }
  return Object.entries(services).filter(([, value]) => typeof value === 'object' && 'build' in value)
    .map(([service]) => service);
}

function imageOverride(inventory: BuildInventory): string {
  const services = inventory.images.flatMap(({ tag, service }) => [
    `  ${JSON.stringify(service)}:`,
    `    image: ${JSON.stringify(tag)}`,
    '    pull_policy: never',
    '    build:',
    // Additional author tags must not escape the session through the build backend.
    '      tags: !reset []',
    '      labels:',
    `        ${ownerLabel}: ${JSON.stringify(inventory.owner)}`,
    `        ${serviceLabel}: ${JSON.stringify(service)}`,
  ]);
  return ['services:', ...services, ''].join('\n');
}

async function build(request: ComposeStartRequest): Promise<void> {
  const options = composeOptions(request, ['--with-dependencies']);
  if (request.serviceSelection.kind === 'all') {
    await dockerCompose.buildAll(options);
    return;
  }
  const selected = new Set(request.serviceSelection.services);
  if (request.telemetry.kind === 'enabled') {
    for (const { service } of request.telemetry.participants) {
      selected.add(service);
    }
  }
  await dockerCompose.buildMany([...selected], options);
}

export async function buildSandboxImages(request: ComposeStartRequest, docker: BuildImageDocker): Promise<ComposeStartRequest> {
  const services = await buildServices(request);
  if (services.length === 0) {
    return request;
  }
  const inventory = planInventory(request.projectName, services);
  await requireUnusedTags(docker, inventory);
  await writeInventory(request.generatedComposeDirectory, inventory, 'create');
  const override = join(request.generatedComposeDirectory, 'build-images.compose.yaml');
  await writeFile(override, imageOverride(inventory), { flag: 'wx', mode: 0o600 });
  const scoped = { ...request, composeFiles: [...request.composeFiles, override] };
  try {
    await build(scoped);
    await writeInventory(request.generatedComposeDirectory, await observedInventory(docker, inventory), 'update');
    return scoped;
  } catch (cause) {
    try {
      await removeRecordedImages(docker, inventory);
    } catch (cleanupError) {
      throw new AggregateError([cause, cleanupError], 'Sandbox image build and cleanup failed');
    }
    throw cause instanceof Error ? cause : new Error('Sandbox image build failed');
  }
}
