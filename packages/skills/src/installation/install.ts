import { loadBundledSkill, type BundledSkill } from './bundled-skill.js';
import type { SkillAgent } from './hosts.js';
import { installSkillBundle, installSucceeded, type SkillInstallResult } from './install-skill.js';
import { nodeSkillStore } from './store/node-skill-store.js';

export { SKILL_AGENTS, type SkillAgent } from './hosts.js';
export type { SkillDestinationResult, SkillOutcome, SkillWarning } from './install-skill.js';

export interface ProjectSkillInstallation extends SkillInstallResult {
  readonly ok: boolean;
  readonly skill: BundledSkill;
  readonly version: string;
  readonly projectDirectory: string;
}

/**
 * Installs a skill shipped in this package into a project for the selected
 * agents. The project root is `projectDirectory` itself; nothing searches
 * parent directories.
 */
export async function installSkill(input: {
  readonly projectDirectory: string;
  readonly skillName: BundledSkill;
  readonly agents: readonly SkillAgent[];
}): Promise<ProjectSkillInstallation> {
  const bundle = await loadBundledSkill(input.skillName);
  const result = await installSkillBundle({
    bundle,
    agents: input.agents,
    store: nodeSkillStore(input.projectDirectory),
  });
  return {
    ok: installSucceeded(result),
    skill: input.skillName,
    version: bundle.version,
    projectDirectory: input.projectDirectory,
    ...result,
  };
}
