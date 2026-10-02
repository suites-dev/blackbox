import { readFile, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'import-meta-resolve';
import { ModuleLoader, Plugin } from '@oclif/core';
import { isBlackboxCliPluginPackage } from '@suites/blackbox-cli-contract';

export interface SelectedPackage {
  readonly name: string;
  readonly root: string;
  readonly pjson: Record<string, unknown>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const packageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;

async function locate(name: string, owner: string): Promise<SelectedPackage | null> {
  let entry: string;
  try {
    entry = fileURLToPath(resolve(name, pathToFileURL(join(owner, 'package.json')).href));
  } catch (error) {
    if (
      isRecord(error) &&
      ['ERR_MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(String(error.code))
    ) {
      return null;
    }
    throw error;
  }
  let directory = dirname(entry);
  for (;;) {
    try {
      const pjson: unknown = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (!isRecord(pjson) || pjson.name !== name) {
        return null;
      }
      return { name, root: await realpath(directory), pjson };
    } catch (error) {
      if (!isRecord(error) || error.code !== 'ENOENT') {
        throw error;
      }
      const parent = dirname(directory);
      if (parent === directory) {
        return null;
      }
      directory = parent;
    }
  }
}

function contributes(pjson: Record<string, unknown>): boolean {
  return (
    isRecord(pjson.blackbox) &&
    (pjson.blackbox.module !== undefined ||
      pjson.blackbox.skills !== undefined ||
      isBlackboxCliPluginPackage(pjson))
  );
}

/** Only an explicit exported module can activate transitive package contributions. */
export async function selectPackageModules(
  owner: string,
  dependencies: readonly string[],
): Promise<readonly SelectedPackage[]> {
  const selected = new Map<string, SelectedPackage>();
  const visiting = new Set<string>();

  async function visit(name: string, from: string, required: boolean): Promise<void> {
    if (!packageName.test(name)) {
      throw new Error(`Invalid Blackbox module package name: ${name}`);
    }
    const candidate = await locate(name, from);
    if (candidate === null || !contributes(candidate.pjson)) {
      if (required) {
        throw new Error(`Required Blackbox module ${name} is unavailable from ${from}`);
      }
      return;
    }
    if (visiting.has(name)) {
      throw new Error(`Blackbox module dependency cycle at ${name}`);
    }
    const existing = selected.get(name);
    if (existing !== undefined) {
      if (existing.root !== candidate.root) {
        throw new Error(`Conflicting Blackbox module installations: ${name}`);
      }
      return;
    }
    selected.set(name, candidate);
    visiting.add(name);
    const blackbox = candidate.pjson.blackbox as Record<string, unknown>;
    if (blackbox.module !== undefined) {
      const declaration = blackbox.module;
      if (
        !isRecord(declaration) ||
        declaration.apiVersion !== 1 ||
        declaration.export !== './module'
      ) {
        throw new Error(`Unsupported Blackbox module manifest: ${name}`);
      }
      const parent = pathToFileURL(join(candidate.root, 'package.json')).href;
      const loaded = await ModuleLoader.load<unknown>(
        new Plugin({ root: candidate.root }),
        fileURLToPath(resolve(`${name}/module`, parent)),
      );
      const module = isRecord(loaded) ? loaded.blackboxModule : undefined;
      if (
        !isRecord(module) ||
        module.apiVersion !== 1 ||
        !Array.isArray(module.dependencies) ||
        !module.dependencies.every((dependency: unknown) => typeof dependency === 'string')
      ) {
        throw new Error(`Invalid blackboxModule export: ${name}`);
      }
      const declared = isRecord(candidate.pjson.dependencies) ? candidate.pjson.dependencies : {};
      for (const dependency of module.dependencies) {
        if (!Object.hasOwn(declared, dependency)) {
          throw new Error(`Blackbox module ${name} activates undeclared dependency ${dependency}`);
        }
        await visit(dependency, candidate.root, true);
      }
    }
    visiting.delete(name);
  }

  for (const name of [...dependencies].sort()) {
    await visit(name, owner, false);
  }
  return [...selected.values()].sort((left, right) => left.name.localeCompare(right.name));
}
