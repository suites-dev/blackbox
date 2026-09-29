/** The agents `skills install` can target, in the order destinations are reported. */
export const SKILL_AGENTS = ['codex', 'claude', 'cursor'] as const;

export type SkillAgent = (typeof SKILL_AGENTS)[number];

/**
 * Project-relative skills directory each agent discovers. Codex and Cursor share
 * `.agents/skills`; Claude Code reads only `.claude/skills`. Cursor also reads
 * `.cursor/skills` and, as compatibility locations, `.claude/skills` and
 * `.codex/skills`, and lists a skill once per location. Sharing `.agents/skills`
 * keeps Cursor to one listing unless `.claude/skills` is also written (see the
 * cursor-duplicate-listing warning).
 */
const AGENT_DIRECTORIES = {
  codex: '.agents/skills',
  claude: '.claude/skills',
  cursor: '.agents/skills',
} as const satisfies Readonly<Record<SkillAgent, string>>;

export interface SkillDestination {
  /** Project-relative, `/`-separated. */
  readonly path: string;
  readonly agents: readonly SkillAgent[];
}

/** One destination per distinct directory; repeated agents are ignored. */
export function skillDestinations(
  skill: string,
  agents: readonly SkillAgent[],
): readonly SkillDestination[] {
  const destinations = new Map<string, SkillAgent[]>();
  for (const agent of SKILL_AGENTS) {
    if (!agents.includes(agent)) {
      continue;
    }
    const path = `${AGENT_DIRECTORIES[agent]}/${skill}`;
    destinations.set(path, [...(destinations.get(path) ?? []), agent]);
  }
  return [...destinations].map(([path, selected]) => ({ path, agents: selected }));
}
