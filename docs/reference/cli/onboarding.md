# Onboarding command

**Proposed interface.** The audited source does not implement this command. This page records the intended contract without presenting it as an executable alias.

```sh
npx @suites/blackbox-cli onboarding start
```

With the launcher installed, the same proposed entry point is:

```sh
blackbox onboarding start
```

## Intended result

The command starts an agent-guided setup, not a fully autonomous approval process. It should identify the agent host and repository, install compatible selected capabilities with permission, install the relevant skills, and hand off to Discovery.

The agent then selects the smallest useful system boundary, creates and validates the catalog, enables supported observation, prepares required drivers, runs a focused check, and returns the report and cleanup result.

Missing secrets, unavailable runtimes, unknown topology, and unapproved external dependencies must be explicit blockers. Onboarding must not fill them with guessed values or mark static discovery as a successful live run.

## Preview route

Use [source installation](../../getting-started/installation.md) and [skill installation](skills.md), then give the agent the [onboarding task](../../getting-started/agent-onboarding.md). Do not repeatedly execute a missing command or install an unverified similarly named package.

No flags beyond the proposed `start` entry point are specified here. Add options only when an implementation and its help establish them.

---

[Documentation](../../README.md)
