import CapsuleExec from './commands/capsule/exec.js';
import CapsuleReport from './commands/capsule/report.js';
import CapsuleReportExport from './commands/capsule/report/export.js';
import CapsuleReportServe from './commands/capsule/report/serve.js';
import CapsuleStart from './commands/capsule/start.js';
import CapsuleStop from './commands/capsule/stop.js';
import CatalogList from './commands/catalog/list.js';
import CatalogValidate from './commands/catalog/validate.js';
import DriverInstall from './commands/driver/install.js';
import EffectsBaselineUpdate from './commands/effects/baseline/update.js';
import History from './commands/history.js';
import InstInstall from './commands/inst/install.js';
import Observations from './commands/observations.js';
import Down from './commands/primary/down.js';
import Ls from './commands/primary/ls.js';
import Open from './commands/primary/open.js';
import Report from './commands/primary/report.js';
import Run from './commands/primary/run.js';
import Show from './commands/primary/show.js';
import Systems from './commands/primary/systems.js';
import Up from './commands/primary/up.js';
import Use from './commands/primary/use.js';
import SetupInit from './commands/setup/init.js';
import SkillInstall from './commands/skill/install.js';

/**
 * Explicit oclif command discovery. The visible commands are listed first, in
 * root-help order; hidden aliases and reserved commands follow.
 */
export const COMMANDS = {
  up: Up,
  run: Run,
  down: Down,
  show: Show,
  ls: Ls,
  use: Use,
  open: Open,
  report: Report,
  systems: Systems,
  'catalog:validate': CatalogValidate,
  'driver:install': DriverInstall,
  'inst:install': InstInstall,
  'capsule:start': CapsuleStart,
  'capsule:exec': CapsuleExec,
  'capsule:stop': CapsuleStop,
  'capsule:report': CapsuleReport,
  'capsule:report:serve': CapsuleReportServe,
  'capsule:report:export': CapsuleReportExport,
  'catalog:list': CatalogList,
  observations: Observations,
  history: History,
  'setup:init': SetupInit,
  'skill:install': SkillInstall,
  'effects:baseline:update': EffectsBaselineUpdate,
};

/** Command IDs in root-help order. */
export const ROOT_HELP_ORDER: readonly string[] = Object.keys(COMMANDS);
