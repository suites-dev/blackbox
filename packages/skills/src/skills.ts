import { discoverySkill } from './discovery.js';
import type { SkillModule } from './registry/contracts.js';

export const skillModule = {
  apiVersion: 1,
  packageName: '@suites/blackbox-skills',
  packageRoot: new URL('../', import.meta.url),
  skills: [discoverySkill],
} as const satisfies SkillModule;
