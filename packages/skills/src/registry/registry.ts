import type {
  RegisteredSkillDefinition,
  ResolvedSkillRegistry,
  SkillDefinition,
  SkillModule,
} from './contracts.js';

const skillName = /^[a-z][a-z0-9-]{0,62}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function names(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((name) => typeof name === 'string' && skillName.test(name))
  );
}

function isSkill(value: unknown): value is SkillDefinition {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    skillName.test(value.name) &&
    value.source instanceof URL &&
    value.source.protocol === 'file:' &&
    names(value.dependencies) &&
    names(value.integrations)
  );
}

function isModule(value: unknown): value is SkillModule {
  return (
    isRecord(value) &&
    value.apiVersion === 1 &&
    typeof value.packageName === 'string' &&
    value.packageName.length > 0 &&
    value.packageRoot instanceof URL &&
    value.packageRoot.protocol === 'file:' &&
    Array.isArray(value.skills) &&
    value.skills.every(isSkill)
  );
}

function resolveSkills(
  skills: ReadonlyMap<string, RegisteredSkillDefinition>,
  roots: readonly string[],
): readonly RegisteredSkillDefinition[] {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const result: RegisteredSkillDefinition[] = [];
  const visit = (name: string): void => {
    if (visited.has(name)) {
      return;
    }
    if (visiting.has(name)) {
      throw new Error(`Skill dependency cycle: ${name}`);
    }
    const skill = skills.get(name);
    if (skill === undefined) {
      throw new Error(`Skill is unavailable in the selected plugins: ${name}`);
    }
    visiting.add(name);
    for (const dependency of skill.dependencies) {
      visit(dependency);
    }
    visiting.delete(name);
    visited.add(name);
    result.push(skill);
  };
  for (const root of roots) {
    visit(root);
  }
  return Object.freeze(result);
}

/** Compose only contributions supplied by the host; never discover or download packages here. */
export function createSkillRegistry(modules: readonly unknown[]): ResolvedSkillRegistry {
  const skills = new Map<string, RegisteredSkillDefinition>();
  for (const module of modules) {
    if (!isModule(module)) {
      throw new Error('Invalid Blackbox skill module');
    }
    for (const skill of module.skills) {
      if (skills.has(skill.name)) {
        throw new Error(`Duplicate skill contribution: ${skill.name}`);
      }
      const source = skill.source.href;
      const packageRoot = module.packageRoot.href;
      skills.set(
        skill.name,
        Object.freeze({
          name: skill.name,
          get source() {
            return new URL(source);
          },
          packageName: module.packageName,
          get packageRoot() {
            return new URL(packageRoot);
          },
          dependencies: Object.freeze([...skill.dependencies]),
          integrations: Object.freeze([...skill.integrations]),
        }),
      );
    }
  }
  return Object.freeze({
    skills: Object.freeze([...skills.values()]),
    get: (name: string) => skills.get(name) ?? null,
    resolve: (roots: readonly string[]) => resolveSkills(skills, roots),
  });
}
