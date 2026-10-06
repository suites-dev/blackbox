# Agent skills

Skills are the operating instructions for Blackbox. They guide discovery, configuration, experiments, and evidence interpretation. Packages supply the skills; the CLI copies selected instructions into the coding agent's project-local skill directory.

## Install and inspect

From the target project with a compatible Blackbox composition installed:

```sh
blackbox skills list --json
blackbox skills install blackbox --codex --gitignore
blackbox skills install discovery --codex
blackbox skills install catalog --codex
```

When the Capsule package is selected:

```sh
blackbox skills install capsule --codex
```

Installing the entry skill does not copy every specialist. Skill copying does not download missing packages. A route described by a skill is not evidence that the routed capability is installed.

## Destinations

| Host flag | Project-local destination |
| --- | --- |
| `--codex` | `.agents/skills/<skill>/` |
| `--cursor` | `.agents/skills/<skill>/` |
| `--claude` | `.claude/skills/<skill>/` |

The installer preserves relative references inside the skill. `--gitignore` adds successful destinations to the ignore file. Omit it when your team deliberately versions the installed instructions.

After the agent host discovers the entry skill, invoke it using that host's supported syntax; for example, `$blackbox` in Codex. The installer does not refresh or restart the host.

## What the source preview supplies

| Skill | Responsibility |
| --- | --- |
| `blackbox` | Entry point and routing to available capabilities |
| `discovery` | Static repository understanding and boundary proposals |
| `catalog` | Authoring and validating `blackbox.config.yaml` |
| `capsule` | Live execution, observation, reports, repair, and cleanup |

Test-authoring guidance is also present in the specialist references. Do not invent separate installable `report-reader`, `effects`, or `verification` skill IDs because a diagram mentions those roles. The dedicated SDD bridge is described in the [integration design](../integrations/spec-kit.md).

## Updating instructions

After upgrading the contributing packages, run the installation command again. Unmodified managed copies can be updated; local edits are reported as conflicts rather than silently overwritten. Review a conflict and reconcile intentionally. Do not delete custom instructions merely to make installation succeed.

The CLI discovers skills from selected contributors, not every package in `node_modules`. See the [CLI composition reference](../reference/cli/index.md) when a package is installed but its skill is missing.

Next: [Investigation](investigation-workflow.md) · [Authoring checks](authoring-verification.md).

## Source contract

[Implementation](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/blackbox/README.md). [CLI composition](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/cli/README.md).

---

[Documentation](../README.md)
