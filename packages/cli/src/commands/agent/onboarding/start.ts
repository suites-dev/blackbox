import { Command } from '@oclif/core';

/** Print instructions for an agent to start Blackbox onboarding. */
export default class AgentOnboardingStart extends Command {
  static override description =
    'Print the prompt for an agent to install and load Blackbox onboarding.';

  public async run(): Promise<void> {
    await this.parse(AgentOnboardingStart);
    this.log(`Set up Blackbox for this project:

1. Using this project's package manager and configured registry, install compatible
   versions of these four direct dependencies: @suites/blackbox,
   @suites/blackbox-cli, @suites/blackbox-skills, and
   @suites/blackbox-discovery. Respect the project's existing version and
   lockfile policy.
2. Run the locally installed blackbox executable to install the blackbox and
   discovery skills for your agent host. Use:
   blackbox skills install blackbox --codex
   blackbox skills install discovery --codex
   Replace --codex with --claude or --cursor when appropriate.
3. Load and read the installed blackbox skill (SKILL.md), then follow its
   references/onboarding.md instructions to continue onboarding. Read the
   installed discovery skill when the onboarding route calls for it.

This command only prints this prompt; it does not install or start anything.`);
  }
}
