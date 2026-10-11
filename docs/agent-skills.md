# Onboard your coding agent

Start Blackbox onboarding from the application root:

```sh
npx @suites/blackbox-cli@alpha onboarding start
```

The guided workflow helps set up your coding agent, discover the system boundary,
and prepare application configuration for verification. If the CLI is already
installed in your project, use `npx blackbox onboarding start`.

Blackbox skills supply procedures for setup, authoring, execution, and investigation.
The CLI and test runner execute the work.

## Install individual skills

Use the skill commands to add or update selected instructions in an existing setup.

Complete [installation](installation.md) first. Run these commands from the
application root with the project-local CLI:

```sh
npx blackbox skills list
npx blackbox skills install blackbox --codex
npx blackbox skills install discovery --codex
npx blackbox skills install catalog --codex
```

Use `--claude` or `--cursor` for those hosts. Install `capsule` separately when
its package is selected and listed. The installer copies local package content;
it does not download a missing integration or activate an unavailable API.

## Check the result

Codex and Cursor copies live in `.agents/skills/<name>/`; Claude copies live in
`.claude/skills/<name>/`. The host must discover the installed copy before using
it. Ask the agent to inspect the selected skills and the repository's existing
configuration before creating additional infrastructure.

For example:

> Use Blackbox to verify this accepted behavior. Map each claim to an action,
> observation, and completion condition. Reuse suitable system configuration,
> propose the assertions for review, then run them and show the evidence.

No new Gherkin file is required for a native test. Use the
[availability page](alpha-status.md) when installed skill prose mentions candidate
or planned capabilities.

## Update after upgrading packages

Rerun the same installation commands. Unmodified copies can be updated;
locally changed or conflicting copies are preserved and reported as conflicts.
Review those changes before replacing a copy. Optional `--gitignore` ignores
successfully installed destinations; it is not required.

[Entry-package behavior](../packages/blackbox/README.md#start-with-the-agent-skill) ·
[Installer contract](../packages/skills/README.md) ·
[Application setup](playwright/connect-your-application.md)
