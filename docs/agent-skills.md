# Use Blackbox with an agent skill

The discovery skill teaches an agent how to inspect an application, configure a Capsule, run a bounded investigation,
and interpret the evidence. It ships as a portable `SKILL.md` directory with supporting references.
Install the whole directory so those references remain available.

**Current alpha:** project-local installation works through
`blackbox skill install discovery`. Select destinations with `--codex`, `--claude`,
`--cursor`, or repeated `--agent <name>` flags. Use `--json` for machine-readable
results; `--yes` selects all supported agents when no agent flag is supplied.

## Choose a project location

| Host        | Project location for this guide | Discovery and invocation                                                                                                                                    |
| ----------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex       | `.agents/skills/discovery/`     | Scans skills from the working directory up to the repository root. Skills can be selected explicitly or used when relevant. Duplicate names are not merged. |
| Claude Code | `.claude/skills/discovery/`     | Discovers project skills along its documented directory scope; invoke `/discovery` or let Claude select it when relevant.                                   |
| Cursor      | `.agents/skills/discovery/`     | Supports this shared location and `.cursor/skills/`; also recognizes compatibility locations. Skills become available to Agent through discovery.           |

Codex and Cursor can share the `.agents/skills` copy. Do not install the same skill into every supported directory:
compatibility discovery may expose duplicate entries. Claude's project directory remains a separate target; verify
what each host discovers when maintaining a repository used by several agents.

Project installation travels with the repository, making it suitable for teams and fresh checkouts. User-level
installation affects only that user's environment. Cloud agents and remote workers may not receive local user skills;
commit the project installation when the team needs it there. See the current
[Codex](https://learn.chatgpt.com/docs/build-skills), [Claude Code](https://code.claude.com/docs/en/skills), and
[Cursor](https://cursor.com/docs/skills) documentation for discovery, invocation, nested directories, and remote behavior.

## Install the current skill manually

Complete [source installation](installation.md), retaining the `blackbox_checkout` variable. Enter the application
repository you want the agent to work on. For Codex or Cursor:

```sh
skill_target=.agents/skills/discovery
```

For Claude Code, choose this destination instead:

```sh
skill_target=.claude/skills/discovery
```

Then copy the complete skill. This example refuses to replace an existing destination, including a dangling symlink:

```sh
if [ -e "$skill_target" ] || [ -L "$skill_target" ]; then
  printf 'Skill destination already exists: %s\n' "$skill_target" >&2
else
  mkdir -p "$(dirname "$skill_target")"
  cp -R "$blackbox_checkout/agent-skills/skills/discovery" "$skill_target"
fi
```

You should now have `SKILL.md` and its `references/` directory at the chosen destination. Review the copied files,
then check that the host lists or discovers the skill; restart or reload the host if its documented behavior requires
it. A successful copy alone does not demonstrate that the agent loaded it.

Try this task:

> Use the discovery skill to inspect this application's configuration, select a small system boundary, and run a
> Capsule investigation. Explain the command results and runtime evidence, preserve a report, and stop the Capsule.

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

For the first Blackbox installer, the agreed support targets are project-local Codex, Claude Code, and Cursor.
The issue will settle destinations, multi-host behavior, installation method, and update/conflict handling before
implementation. Global installation, arbitrary remote skill sources, and plugin marketplaces are outside that first
version. These are Blackbox scope decisions, not requirements of the shared skill format.

Research checked on 2026-09-27. Recheck the linked primary sources when changing host support.
