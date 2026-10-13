import AgentOnboardingStart from './commands/agent/onboarding/start.js';

/** The host owns bootstrap guidance; plugins register domain commands. */
export const COMMANDS = {
  'agent:onboarding:start': AgentOnboardingStart,
};
export const ROOT_HELP_ORDER: readonly string[] = Object.keys(COMMANDS);
