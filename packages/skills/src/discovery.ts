import type { SkillDefinition } from './registry/contracts.js';

export const discoverySkill = {
  name: 'discovery',
  source: new URL('../assets/discovery/', import.meta.url),
  dependencies: [],
  integrations: ['catalog', 'capsule'],
} as const satisfies SkillDefinition;
