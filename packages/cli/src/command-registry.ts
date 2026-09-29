import CapsuleDown from './commands/capsule/down.js';
import CapsuleLs from './commands/capsule/ls.js';
import CapsuleReport from './commands/capsule/report.js';
import CapsuleReportExport from './commands/capsule/report/export.js';
import CapsuleReportServe from './commands/capsule/report/serve.js';
import CapsuleRun from './commands/capsule/run.js';
import CapsuleShow from './commands/capsule/show.js';
import CapsuleUp from './commands/capsule/up.js';
import CapsuleUse from './commands/capsule/use.js';
import CatalogLs from './commands/catalog/ls.js';
import CatalogValidate from './commands/catalog/validate.js';
import DriverInstall from './commands/driver/install.js';
import EffectsBaselineUpdate from './commands/effects/baseline/update.js';
import History from './commands/history.js';
import InstInstall from './commands/inst/install.js';
import Observations from './commands/observations.js';
import SetupInit from './commands/setup/init.js';
import SkillInstall from './commands/skill/install.js';

/**
 * Explicit oclif command discovery. Every command names the noun it acts on;
 * the visible commands are listed first, in root-help order, and the reserved
 * hidden commands follow.
 */
export const COMMANDS = {
  'capsule:up': CapsuleUp,
  'capsule:run': CapsuleRun,
  'capsule:down': CapsuleDown,
  'capsule:show': CapsuleShow,
  'capsule:ls': CapsuleLs,
  'capsule:use': CapsuleUse,
  'capsule:report': CapsuleReport,
  'capsule:report:serve': CapsuleReportServe,
  'capsule:report:export': CapsuleReportExport,
  'catalog:ls': CatalogLs,
  'catalog:validate': CatalogValidate,
  'driver:install': DriverInstall,
  'inst:install': InstInstall,
  observations: Observations,
  history: History,
  'setup:init': SetupInit,
  'skill:install': SkillInstall,
  'effects:baseline:update': EffectsBaselineUpdate,
};

/** Command IDs in root-help order. */
export const ROOT_HELP_ORDER: readonly string[] = Object.keys(COMMANDS);
