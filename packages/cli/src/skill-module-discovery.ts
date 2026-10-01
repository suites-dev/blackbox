import { createRequire } from 'node:module';
import { join } from 'node:path';

type ModuleLoader = (specifier: string, packageRoot: string) => unknown;

interface SkillPlugin {
  readonly name: string;
  readonly root: string;
  readonly pjson: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function skillModuleExport(plugin: SkillPlugin): string | null {
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

const loadModule: ModuleLoader = (specifier, packageRoot) =>
  createRequire(join(packageRoot, 'package.json'))(specifier) as unknown;

/** Load skill contributions only from the plugin set selected by the CLI composition root. */
export async function loadCliSkillModules(
  plugins: ReadonlyMap<string, SkillPlugin>,
  loader: ModuleLoader = loadModule,
): Promise<readonly unknown[]> {
  const contributions: unknown[] = [];
  const selected = [...plugins.values()].sort((left, right) => left.name.localeCompare(right.name));
  for (const plugin of selected) {
    const specifier = skillModuleExport(plugin);
    if (specifier === null) {
      continue;
    }
    const loaded = await loader(specifier, plugin.root);
    if (!isRecord(loaded) || !Object.hasOwn(loaded, 'skillModule')) {
      throw new Error(`Blackbox plugin ${plugin.name} did not export skillModule from ./skills.`);
    }
    contributions.push(loaded.skillModule);
  }
  return contributions;
}
