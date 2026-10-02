import { fileURLToPath } from 'node:url';
import { Errors, Plugin, flush, run, type Interfaces } from '@oclif/core';
import { bindCliSkillModules, isBlackboxCliPluginPackage } from '@suites/blackbox-cli-contract';
import { discoverProjectCliPlugins } from './plugin-discovery.js';
import { loadCliSkillModules } from './skill-module-discovery.js';

/** Shared host for the main product launcher and advanced standalone CLI installations. */
export async function runCli(
  argv: string[],
  options: { readonly installationDirectory: URL } = {
    installationDirectory: new URL('../', import.meta.url),
  },
): Promise<void> {
  try {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const selection = await discoverProjectCliPlugins(
      process.cwd(),
      fileURLToPath(options.installationDirectory),
    );
    const host = new Plugin({ root, isRoot: true });
    await host.load();
    const plugins = new Map<string, Interfaces.Plugin>([[host.name, host]]);
    const packages = selection === null ? [] : selection.packages;
    for (const candidate of packages) {
      if (!isBlackboxCliPluginPackage(candidate.pjson)) {
        continue;
      }
      const plugin = new Plugin({ root: candidate.root, type: 'core' });
      await plugin.load();
      plugins.set(plugin.name, plugin);
    }
    const configuration = { root, plugins };
    bindCliSkillModules(
      configuration,
      await loadCliSkillModules(new Map(packages.map((candidate) => [candidate.name, candidate]))),
    );
    await run(argv, configuration);
    await flush();
  } catch (error) {
    await Errors.handle(error instanceof Error ? error : new Error(String(error)));
  }
}
