export interface SkillDefinition {
  readonly name: string;
  readonly source: URL;
  readonly dependencies: readonly string[];
  readonly integrations: readonly string[];
}

export interface SkillModule {
  readonly apiVersion: 1;
  readonly packageName: string;
  readonly packageRoot: URL;
  readonly skills: readonly SkillDefinition[];
}

export interface RegisteredSkillDefinition extends SkillDefinition {
  readonly packageName: string;
  readonly packageRoot: URL;
}

export interface ResolvedSkillRegistry {
  readonly skills: readonly RegisteredSkillDefinition[];
  readonly get: (name: string) => RegisteredSkillDefinition | null;
  readonly resolve: (roots: readonly string[]) => readonly RegisteredSkillDefinition[];
}
