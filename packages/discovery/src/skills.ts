import type { SkillDefinition, SkillModule } from '@suites/blackbox-skills';

export const discoverySkill = {
  name: 'discovery',
  source: new URL('../skills/discovery/', import.meta.url),
  dependencies: [],
  integrations: ['catalog', 'capsule'],
} as const satisfies SkillDefinition;

export const skillModule = {
  apiVersion: 1,
  packageName: '@suites/blackbox-discovery',
  packageRoot: new URL('../', import.meta.url),
  skills: [discoverySkill],
} as const satisfies SkillModule;

declare module '@suites/blackbox-skills' {
  interface SkillRegistry {
    readonly discovery: typeof discoverySkill;
  }
}
