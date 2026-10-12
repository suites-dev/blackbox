import type { SkillDefinition, SkillModule } from '@suites/blackbox-skills';

export const featureFileAuthoringSkill = {
  name: 'feature-file-authoring',
  source: new URL('../skills/feature-file-authoring/', import.meta.url),
  dependencies: [],
  integrations: ['catalog'],
} as const satisfies SkillDefinition;

export const skillModule = {
  apiVersion: 1,
  packageName: '@suites/blackbox-feature',
  packageRoot: new URL('../', import.meta.url),
  skills: [featureFileAuthoringSkill],
} as const satisfies SkillModule;

declare module '@suites/blackbox-skills' {
  interface SkillRegistry {
    readonly 'feature-file-authoring': typeof featureFileAuthoringSkill;
  }
}
