import OnboardingStart from './commands/onboarding/start.js';

/** The host owns the onboarding handoff. Domain commands come from selected plugins. */
export const COMMANDS = { 'onboarding:start': OnboardingStart } as const;
export const ROOT_HELP_ORDER: readonly string[] = Object.keys(COMMANDS);
