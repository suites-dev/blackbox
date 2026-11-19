import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { replaceFile } from '../replace-file.js';

export const ownerLabel = 'io.suites.blackbox.build-owner';
export const serviceLabel = 'io.suites.blackbox.build-service';
export interface ImageEntry {
  readonly service: string;
  readonly tag: string;
  readonly imageId: string | null;
}

export interface BuildInventory {
  readonly schemaVersion: 1;
  readonly projectName: string;
  readonly owner: string;
  readonly images: readonly ImageEntry[];
}

function tagFor(projectName: string, owner: string, service: string): string {
  const digest = createHash('sha256').update(service).digest('hex').slice(0, 24);
  return `blackbox-local/${projectName}:${owner}-${digest}`;
}

export function planInventory(projectName: string, services: readonly string[]): BuildInventory {
  const owner = randomUUID();
  return { schemaVersion: 1, projectName, owner, images: services.map((service) => ({
    service, tag: tagFor(projectName, owner, service), imageId: null,
  })) };
}

export function missing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && Reflect.get(error, 'statusCode') === 404;
}

function inventoryPath(directory: string): string {
  return join(directory, 'build-images.json');
}

export async function writeInventory(directory: string, inventory: BuildInventory, mode: 'create' | 'update'): Promise<void> {
  await mkdir(directory, { recursive: true });
  // An atomic rename publishes the complete intent before the first Docker build.
  const target = inventoryPath(directory);
  const temporary = `${target}.${inventory.owner}.tmp`;
  await writeFile(temporary, JSON.stringify(inventory, null, 2), { flag: 'wx', mode: 0o600 });
  if (mode === 'update') {
    await replaceFile(temporary, target);
  } else {
    try {
      await link(temporary, target);
    } finally {
      await unlink(temporary);
    }
  }
}

function validEntry(value: unknown, projectName: string, owner: string): value is ImageEntry {
  return typeof value === 'object' && value !== null &&
    'service' in value && typeof value.service === 'string' &&
    'tag' in value && value.tag === tagFor(projectName, owner, value.service) &&
    'imageId' in value && (value.imageId === null ||
      (typeof value.imageId === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value.imageId)));
}

export async function readInventory(directory: string, projectName: string): Promise<BuildInventory | null> {
  let bytes: string;
  try {
    bytes = await readFile(inventoryPath(directory), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  return parseInventory(JSON.parse(bytes), projectName);
}

function parseInventory(value: unknown, projectName: string): BuildInventory {
  if (typeof value !== 'object' || value === null || !('schemaVersion' in value) || value.schemaVersion !== 1 ||
    !('projectName' in value) || value.projectName !== projectName || !('owner' in value) ||
    typeof value.owner !== 'string' || !/^[a-f0-9-]{36}$/u.test(value.owner) ||
    !('images' in value) || !Array.isArray(value.images)) {
    throw new Error('Invalid Sandbox build image ownership record');
  }
  const { owner, images } = value;
  if (!images.every((entry: unknown): entry is ImageEntry => validEntry(entry, projectName, owner))) {
    throw new Error('Invalid Sandbox build image identity');
  }
  return { schemaVersion: 1, projectName, owner, images };
}
