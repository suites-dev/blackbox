import type { ResolvedSkillRegistry } from '../registry/contracts.js';
import { loadRegisteredSkill } from './bundled-skill.js';
import type { SkillAgent } from './hosts.js';
import { ignoreInstalledSkills, type SkillGitIgnoreResult } from './ignore/git-ignore.js';
import { installSkillBundle, installSucceeded, type SkillInstallResult } from './install-skill.js';
import { nodeSkillStore } from './store/node-skill-store.js';

export { SKILL_AGENTS, type SkillAgent } from './hosts.js';
export type { SkillDestinationResult, SkillOutcome } from './install-skill.js';

export interface InstalledSkill extends SkillInstallResult {
  readonly skill: string;
  readonly version: string;
  readonly sourcePackage: string;
}

export interface ProjectSkillInstallation extends SkillInstallResult {
  readonly gitignore: SkillGitIgnoreResult;
  readonly ok: boolean;
  readonly skill: string;
  readonly version: string;
  readonly sourcePackage: string;
  readonly projectDirectory: string;
  readonly installations: readonly InstalledSkill[];
}

/**
 * Install a contributed skill and its required skill dependencies. The registry
 * is supplied by the caller or CLI composition root; no feature is registered implicitly.
 */
export async function installSkill(
  input: {
    readonly projectDirectory: string;
    readonly skillName: string;
    readonly agents: readonly SkillAgent[];
  },
  registry: ResolvedSkillRegistry,
  options: { readonly gitignore: boolean } = { gitignore: false },
): Promise<ProjectSkillInstallation> {
  const selected = registry.resolve([input.skillName]);
  const loaded = await Promise.all(selected.map((skill) => loadRegisteredSkill(skill)));
  const store = nodeSkillStore(input.projectDirectory);
  const installations: InstalledSkill[] = [];
  for (const skill of loaded) {
    const result = await installSkillBundle({ bundle: skill.bundle, agents: input.agents, store });
    installations.push({
      skill: skill.bundle.name,
      version: skill.bundle.version,
      sourcePackage: skill.packageName,
      ...result,
    });
    if (!installSucceeded(result)) {
      break;
    }
  }
  const root = loaded.find(({ bundle }) => bundle.name === input.skillName);
  if (root === undefined) {
    throw new Error(`Skill resolution omitted requested root: ${input.skillName}`);
  }
  const destinations = installations.flatMap(({ destinations: entries }) => entries);
  const gitignore: SkillGitIgnoreResult = options.gitignore
    ? await ignoreInstalledSkills(
        input.projectDirectory,
        destinations
          .filter(({ outcome }) => outcome !== 'conflict' && outcome !== 'failed')
          .map(({ path }) => path),
      )
    : { outcome: 'not-requested', message: null };
  return {
    ok:
      installations.length === loaded.length &&
      installations.every(installSucceeded) &&
      gitignore.outcome !== 'failed',
    gitignore,
    skill: input.skillName,
    version: root.bundle.version,
    sourcePackage: root.packageName,
    projectDirectory: input.projectDirectory,
    installations,
    destinations,
  };
}
