import SkillInstall from './commands/skills/install.js';
import SkillsList from './commands/skills/list.js';

export const COMMANDS = {
  'skills:install': SkillInstall,
  'skill:install': SkillInstall,
  'skills:list': SkillsList,
};
