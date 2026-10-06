---
name: blackbox
description: Help users adopt or operate Suites Blackbox for system testing, inspect installed capabilities, and route setup, catalog authoring, or live validation to available package skills.
---

# Blackbox

Blackbox supports system tests with isolated execution and retained runtime evidence.
A passing response alone does not establish the system's side effects, observation
coverage, or cleanup. Start with the user's intended behavior and existing setup;
do not turn an explanation or inspection request into a live experiment.

## Check what is available

Use the project's installed `blackbox` executable through its existing package
manager, for example `pnpm exec blackbox` or `npm exec --no -- blackbox`. Do not use a command that downloads a
missing CLI on demand. From the target project, inspect:

```sh
blackbox --help
blackbox skills list --json
```

The list describes skills contributed by the selected packages, not skills loaded
by the agent. Also check the host's available skills before routing. An old copied
directory, an unselected transitive dependency, or a TypeScript name does not establish current
availability. A failed list command is an unknown inventory, not an empty one.

If the CLI or `skills` command is missing, inspect the project's dependencies and
explain that the normal setup explicitly installs `@suites/blackbox-cli` for the
`blackbox` command alongside `@suites/blackbox` for Skills, Catalog, Discovery, and
this entry skill. The main package has no executable of its own; do not rely on
transitive CLI installation to expose the command. Custom compositions may omit core modules.
Do not install or change dependencies without authorization. Read
[skill installation](references/skill-installation.md) when a needed skill is
missing, stale, or not visible to the current host.

## Route the user's task

Use these routes only when the corresponding package contribution and host skill
are both available. Read the selected skill's instructions; do not reconstruct its
procedure from this table or guess paths inside `node_modules`.

| User task                                                                            | Skill       | Owning package               |
| ------------------------------------------------------------------------------------ | ----------- | ---------------------------- |
| Understand an application's boundary; set up, reconcile, or repair Blackbox adoption | `discovery` | `@suites/blackbox-discovery` |
| Author or validate project topology and Compose-backed catalog entries               | `catalog`   | `@suites/blackbox-catalog`   |
| Execute an accepted behavior; inspect its observations, report, and cleanup          | `capsule`   | `@suites/blackbox-capsule`   |

These are independent, optional integrations, not a mandatory sequence. Route a
direct Catalog or Capsule request directly when its prerequisites are satisfied;
do not require Discovery for either. Discovery owns its own subsequent routing.
For another contributed skill, use its available description and instructions when
they match the request. Never route back to `blackbox` as its own specialist.

Pass the user's scope, relevant project paths, accepted behavior or terminal
predicate, existing evidence, and execution permissions to the chosen skill.
Delegation does not authorize installs, containers, listeners, network access, or
other mutations beyond the user's request.

If Capsule is absent, say "I don't have the Capsule skill in this project" and
identify the missing contribution or host installation. Continue any useful
authorized explanation or static work; mark the live stage blocked. Apply the
same distinction to other missing skills. Never silently install an integration
or treat stale instructions as an available provider.

## Work without a specialist

For general Blackbox questions, explain the relevant concepts or inspect the
installed command's `--help`. For capabilities without an available skill, use
the installed package's public documentation and help; disclose that there is no
specialist skill. Do not invent APIs or treat planned commands as implemented.

Keep operational details in their owning skills. Live work must retain exact
Capsule/activity identities and separate execution, observation, and cleanup
outcomes. Do not infer behavioral proof from an exit code or manufacture receipts.
Finish with the result or next concrete action, what actually ran or changed, and
any missing capability. If asked only for guidance, no execution is required.
