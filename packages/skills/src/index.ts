import type { SkillDefinition } from './registry/contracts.js';

export type { SkillAgent } from './installation/install.js';
export { installSkill } from './installation/install.js';
export { createSkillRegistry } from './registry/registry.js';
export type {
  RegisteredSkillDefinition,
  SkillDefinition,
  SkillModule,
  ResolvedSkillRegistry,
} from './registry/contracts.js';

/** Feature packages augment this public interface from their ESM skill entrypoint. */
export interface SkillRegistry {
  readonly discovery: SkillDefinition;
}

export type SkillName = keyof SkillRegistry;
