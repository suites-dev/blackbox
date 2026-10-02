import type { SkillDefinition, SkillModule } from '@suites/blackbox-skills';

export const blackboxSkill = {
  name: 'blackbox',
  source: new URL('../skills/blackbox/', import.meta.url),
  dependencies: [],
  integrations: ['discovery', 'catalog', 'capsule'],
} as const satisfies SkillDefinition;

export const skillModule = {
  apiVersion: 1,
  packageName: '@suites/blackbox',
  packageRoot: new URL('../', import.meta.url),
  skills: [blackboxSkill],
} as const satisfies SkillModule;

declare module '@suites/blackbox-skills' {
  interface SkillRegistry {
    readonly blackbox: typeof blackboxSkill;
  }
}
