import type { SkillDefinition, SkillModule } from '@suites/blackbox-skills';

export const catalogSkill = {
  name: 'catalog',
  source: new URL('../assets/catalog/', import.meta.url),
  dependencies: [],
  integrations: [],
} as const satisfies SkillDefinition;

export const skillModule = {
  apiVersion: 1,
  packageName: '@suites/blackbox-catalog',
  skills: [catalogSkill],
} as const satisfies SkillModule;

declare module '@suites/blackbox-skills' {
  interface SkillRegistry {
    readonly catalog: typeof catalogSkill;
  }
}
