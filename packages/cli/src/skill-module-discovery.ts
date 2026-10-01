import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ModuleLoader, type Interfaces } from '@oclif/core';
import { resolve } from 'import-meta-resolve';

type SkillModuleLoader = (specifier: string, plugin: Interfaces.Plugin) => unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function skillModuleExport(plugin: Interfaces.Plugin): string | null {
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
  const entrypoint = fileURLToPath(resolve(specifier, parent));
  return ModuleLoader.load<unknown>(plugin, entrypoint);
};

/** Load skill contributions only from the plugin set selected by the CLI composition root. */
export async function loadCliSkillModules(
  plugins: ReadonlyMap<string, Interfaces.Plugin>,
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
