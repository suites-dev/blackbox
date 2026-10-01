# Use Blackbox with agent skills

Blackbox packages contribute portable agent skills through the same selected-plugin
composition used by the CLI. The Skills package contributes `discovery`, Catalog
contributes `catalog`, and Capsule contributes `capsule`. A package that is not in
the CLI composition contributes no runtime skill module and therefore no
installable skill.

List the contributions that are actually available before installing one:

```sh
blackbox skills list
blackbox skills list --json
```

The JSON form also reports whether each optional integration named by a skill is
available. Discovery can always perform static inspection. It routes catalog
authoring to the Catalog skill and live experiments to the Capsule skill only when
those packages contributed them. Installing Discovery never downloads a package or
implicitly installs either optional skill.

Install a selected skill into the current project with `skills install` (the
singular `skill install` spelling remains an alias):

```sh
blackbox skills install discovery --codex
blackbox skills install catalog --claude
blackbox skills install capsule --cursor
```

Use repeated `--agent <name>` flags or the `--codex`, `--claude`, and `--cursor`
shortcuts. `--yes` selects all supported hosts when no host flag is supplied, and
`--json` returns a machine-readable result. Existing different files are conflicts;
the installer does not overwrite them.

## Choose a project location

| Host        | Project location          | Discovery and invocation                                                                                                                                    |
| ----------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex       | `.agents/skills/<skill>/` | Scans skills from the working directory up to the repository root. Skills can be selected explicitly or used when relevant. Duplicate names are not merged. |
| Claude Code | `.claude/skills/<skill>/` | Discovers project skills along its documented directory scope; invoke the skill or let Claude select it when relevant.                                      |
| Cursor      | `.cursor/skills/<skill>/` | Discovers project skills for Cursor Agent. Cursor can also recognize the shared `.agents/skills/` compatibility location.                                   |

When Codex and Cursor are selected together, the installer uses their shared
`.agents/skills` compatibility location instead of publishing duplicate copies.
Claude's project directory remains a separate target. Verify what each host
discovers when maintaining a repository used by several agents.

Project installation travels with the repository, making it suitable for teams and fresh checkouts. User-level
installation affects only that user's environment. Cloud agents and remote workers may not receive local user skills;
commit the project installation when the team needs it there. See the current
[Codex](https://learn.chatgpt.com/docs/build-skills), [Claude Code](https://code.claude.com/docs/en/skills), and
[Cursor](https://cursor.com/docs/skills) documentation for discovery, invocation, nested directories, and remote behavior.

## Install a skill manually

Complete [source installation](installation.md), retaining the `blackbox_checkout` variable. Enter the application
repository you want the agent to work on. For Codex or Cursor:

```sh
skill_target=.agents/skills/discovery
```

For Claude Code, choose this destination instead:

```sh
skill_target=.claude/skills/discovery
```

Then copy the complete Discovery skill from its owning package. This example
refuses to replace an existing destination, including a dangling symlink:

```sh
if [ -e "$skill_target" ] || [ -L "$skill_target" ]; then
  printf 'Skill destination already exists: %s\n' "$skill_target" >&2
else
  mkdir -p "$(dirname "$skill_target")"
  cp -R "$blackbox_checkout/packages/skills/assets/discovery" "$skill_target"
fi
```

You should now have `SKILL.md` and its `references/` directory at the chosen destination. Review the copied files,
then check that the host lists or discovers the skill; restart or reload the host if its documented behavior requires
it. A successful copy alone does not demonstrate that the agent loaded it.

Catalog and Capsule have the same portable layout under
`packages/catalog/assets/catalog` and `packages/capsule/assets/capsule`. Manual
copying does not change which CLI packages are installed or selected.

Try this static task with Discovery alone:

> Use the discovery skill to inspect this application's configuration, inventory
> its boundaries, and state which claims still require live runtime evidence.

With the Capsule skill also available, try:

> Use the discovery and capsule skills to select a small system boundary, run a
> bounded investigation, explain the runtime evidence, preserve a report, and stop
> the Capsule.

The skill does not install Blackbox, grant execution permissions, or make planned Playwright/effect APIs available.
Its instructions should always match the CLI version used by the project.

## Maintain one portable source

Keep the skill's purpose and trigger description in its frontmatter. Put longer, task-specific procedures in references
and keep links relative to the installed directory. Platform-specific metadata may improve a host's presentation or
invocation controls, but it must not become necessary to understand the common instructions.
The [Agent Skills specification](https://agentskills.io/specification) defines the shared format and progressive loading.

When updating, compare the installed directory with the version from the intended Blackbox checkout. Preserve local
edits and review changed instructions before replacing them. Record the source revision in your update change; avoid
silently tracking a moving branch while the project's CLI stays pinned to an older release.

## What existing projects teach us

| Maintained project                                       | Approach                                                                                                           | Lesson for Blackbox                                                                                                                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Vercel skills](https://github.com/vercel-labs/skills)   | Explicit agent selection, project/global scope, canonical-copy symlinks or independent copies, and update tooling. | Separate skill content from host installation and make update ownership visible. Evaluate symlinks versus copies and duplicate discovery before choosing the installer contract. |
| [Anthropic skills](https://github.com/anthropics/skills) | Portable skill directories, with plugin distribution for Claude Code.                                              | Keep references/assets bundled; treat plugin distribution as a distinct option, not a prerequisite for a project skill.                                                          |

The current installer supports project-local Codex, Claude Code, and Cursor.
Global installation, arbitrary remote skill sources, and plugin marketplaces are
outside the current alpha contract. These are Blackbox scope decisions, not
requirements of the shared skill format.

Research checked on 2026-09-27. Recheck the linked primary sources when changing host support.
