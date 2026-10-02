import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'import-meta-resolve';
import { ModuleLoader, Plugin } from '@oclif/core';

interface SkillSource {
  readonly name: string;
  readonly root: string;
  readonly pjson: unknown;
}

type SkillModuleLoader = (specifier: string, plugin: SkillSource) => unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function skillModuleExport(plugin: SkillSource): string | null {
  const manifest = plugin.pjson;
  if (!isRecord(manifest)) {
    throw new Error(`Blackbox plugin ${plugin.name} has an invalid package manifest.`);
  }
  if (!isRecord(manifest.blackbox) || !isRecord(manifest.blackbox.skills)) {
    return null;
  }
  const skills = manifest.blackbox.skills;
  if (skills.apiVersion !== 1 || skills.export !== './skills') {
    throw new Error(
      `Blackbox plugin ${plugin.name} declares an unsupported skill module manifest.`,
    );
  }
  return `${plugin.name}/skills`;
}

const loadModule: SkillModuleLoader = (specifier, plugin) => {
  const parent = pathToFileURL(join(plugin.root, 'package.json')).href;
  // Resolve ESM conditions from the provider first; oclif only loads the exact file.
  return ModuleLoader.load<unknown>(
    new Plugin({ root: plugin.root }),
    fileURLToPath(resolve(specifier, parent)),
  );
};

/** Skill-only packages do not need an oclif plugin or an empty command registry. */
export async function loadCliSkillModules(
  plugins: ReadonlyMap<string, SkillSource>,
  loader: SkillModuleLoader = loadModule,
): Promise<readonly unknown[]> {
  const contributions: unknown[] = [];
  const selected = [...plugins.values()].sort((left, right) => left.name.localeCompare(right.name));
  for (const plugin of selected) {
    const specifier = skillModuleExport(plugin);
    if (specifier === null) {
      continue;
    }
    const loaded = await loader(specifier, plugin);
    if (!isRecord(loaded) || !Object.hasOwn(loaded, 'skillModule')) {
      throw new Error(`Blackbox plugin ${plugin.name} did not export skillModule from ./skills.`);
    }
    contributions.push(loaded.skillModule);
  }
  return contributions;
}
