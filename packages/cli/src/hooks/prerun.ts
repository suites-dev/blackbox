import type { Hook } from '@oclif/core';
import { bindCliSkillModules } from '@suites/blackbox-cli-contract';

import { loadCliSkillModules } from '../skill-module-discovery.js';

/** Compose skill modules after oclif has loaded the selected plugin set. */
const hook: Hook.Prerun = async ({ config }) => {
  bindCliSkillModules(config, await loadCliSkillModules(config.plugins));
};

export default hook;
