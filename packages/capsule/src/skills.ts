import type { SkillDefinition, SkillModule } from '@suites/blackbox-skills';

export const capsuleSkill = {
  name: 'capsule',
  source: new URL('../assets/capsule/', import.meta.url),
  dependencies: [],
  integrations: [],
} as const satisfies SkillDefinition;

export const skillModule = {
  apiVersion: 1,
  packageName: '@suites/blackbox-capsule',
  skills: [capsuleSkill],
} as const satisfies SkillModule;

declare module '@suites/blackbox-skills' {
  interface SkillRegistry {
    readonly capsule: typeof capsuleSkill;
  }
}
