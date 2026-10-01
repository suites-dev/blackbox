import { discoverySkill } from './discovery.js';
import type { SkillModule } from './registry/contracts.js';

export const skillModule = {
  apiVersion: 1,
  packageName: '@suites/blackbox-skills',
  skills: [discoverySkill],
} as const satisfies SkillModule;
