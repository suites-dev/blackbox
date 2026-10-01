export interface SkillDefinition {
  readonly name: string;
  readonly source: URL;
  readonly dependencies: readonly string[];
  readonly integrations: readonly string[];
}

export interface SkillModule {
  readonly apiVersion: 1;
  readonly packageName: string;
  readonly skills: readonly SkillDefinition[];
}

export interface ResolvedSkillRegistry {
  readonly skills: readonly SkillDefinition[];
  readonly get: (name: string) => SkillDefinition | null;
  readonly resolve: (roots: readonly string[]) => readonly SkillDefinition[];
}
