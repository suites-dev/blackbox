import Down from './commands/capsule/down.js';
import Ls from './commands/capsule/ls.js';
import Report from './commands/report.js';
import CapsuleReportExport from './commands/capsule/report/export.js';
import CapsuleReportServe from './commands/capsule/report/serve.js';
import Run from './commands/capsule/run.js';
import Show from './commands/capsule/show.js';
import Up from './commands/capsule/up.js';
import Use from './commands/capsule/use.js';
import Observations from './commands/observations.js';

export const COMMANDS = {
  'capsule:up': Up,
  'capsule:run': Run,
  'capsule:down': Down,
  'capsule:show': Show,
  'capsule:ls': Ls,
  'capsule:use': Use,
  'capsule:report': Report,
  'capsule:report:serve': CapsuleReportServe,
  'capsule:report:export': CapsuleReportExport,
  observations: Observations,
};

export const ROOT_HELP_ORDER: readonly string[] = Object.keys(COMMANDS);
