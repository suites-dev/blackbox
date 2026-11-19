# Blackbox agent skills

From an application with the Blackbox CLI installed, run
`blackbox onboarding start`. It prints the installed package and command inventory
and a prompt for your coding agent. The command does not change the application.
See [Get started](../README.md#get-started) for the package installation.

Install the project-local entry skill for your agent host:

```sh
blackbox skills list --json
blackbox skills install blackbox --codex
```

Use `--claude` or `--cursor` for those hosts. The main package contributes the
`blackbox`, `catalog`, and `discovery` skills. Install a specialist separately when
you need it; the `capsule` skill requires the Capsule package to be selected.
The [main package guide](../packages/blackbox/README.md#start-with-the-agent-skill)
explains destinations, updates, and conflicts. A listed contribution is not yet a
skill installed in the agent host.

## Historical sources

This directory retains provenance for the earlier skill bundle.
[`source-dispositions.json`](source-dispositions.json) records the disposition and
SHA-256 for its 29 historical sources, pinned to commit
`732ecf29e42214a4fd436889dc8898f169335bae`. Those sources are not product
authority or an install-time dependency. The shipped entry skill lives in
[`packages/blackbox/skills/blackbox`](../packages/blackbox/skills/blackbox/).
