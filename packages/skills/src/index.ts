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
// An intentionally empty declaration-merging hook, never used as an object constraint.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface SkillRegistry {}

export type SkillName = keyof SkillRegistry;
