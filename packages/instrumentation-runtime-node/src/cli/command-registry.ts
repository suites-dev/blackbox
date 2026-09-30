import { registerRuntimeActivationAdapters } from '@suites/blackbox-cli-contract';
import { nodeRuntimeActivationAdapters } from '../runtime/bootstrap/adapters.js';
import InstInstall from './commands/inst/install.js';

registerRuntimeActivationAdapters(nodeRuntimeActivationAdapters);

export const COMMANDS = {
  'inst:install': InstInstall,
};
