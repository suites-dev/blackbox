import { Command, Flags } from '@oclif/core';
import { readCliSkillModules } from '@suites/blackbox-cli-contract';
import { createSkillRegistry } from '../../../registry/registry.js';
import { skillModule } from '../../../skills.js';

export default class SkillsList extends Command {
  static override description = 'List skill contributions from the selected Blackbox plugins.';
  static override flags = { json: Flags.boolean({ default: false }) };

  public async run(): Promise<void> {
    const { flags } = await this.parse(SkillsList);
    const modules = readCliSkillModules(this.config);
    const registry = createSkillRegistry(modules.length === 0 ? [skillModule] : modules);
    const skills = registry.skills.map(({ name, dependencies, integrations }) => ({
      name,
      dependencies,
      integrations: integrations.map((integration) => ({
        name: integration,
        available: registry.get(integration) !== null,
      })),
    }));
    if (flags.json) {
      this.log(JSON.stringify({ kind: 'skill-list', skills }));
    } else {
      for (const skill of skills) {
        this.log(skill.name);
      }
    }
  }
}
