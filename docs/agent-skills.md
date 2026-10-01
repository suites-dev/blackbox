# Use Blackbox with an agent skill

The discovery skill teaches an agent how to inspect an application, configure a Capsule, run a bounded investigation,
and interpret the evidence. It ships as a portable `SKILL.md` directory with supporting references, packed inside the
`@suites/blackbox-skills` package at that package's version.

**Current alpha:** `blackbox skills install discovery` installs the skill into the current project. Command flags and
output may still change while the [CLI vocabulary issue](https://github.com/suites-dev/blackbox/issues/24) is open.

## Install the skill

The `skills` commands come from the `@suites/blackbox-skills` plugin. Add it to your project's dependencies next to
`@suites/blackbox-cli`; the CLI loads Blackbox plugins listed in the nearest `package.json`. Then run the command from
your project's root directory, naming every agent your team uses:

```sh
blackbox skills install discovery --codex --claude
```

`--agent codex|claude|cursor` (repeatable) is equivalent to the per-agent flags, `--yes` selects all three, and in a
terminal without any agent flag the command asks before installing for all three. `blackbox skill install` is an alias.

| Agent    | Destination                 | Discovery and invocation                                                                                                                                                                 |
| -------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codex`  | `.agents/skills/discovery/` | Scans `.agents/skills` from the working directory up to the repository root. Invoke `$discovery` or let Codex select it when relevant. Changes are picked up without a restart.          |
| `claude` | `.claude/skills/discovery/` | Reads only `.claude/skills`, not `.agents/skills`. Invoke `/discovery` or let Claude select it. Start a new session if `.claude/skills/` did not exist when the current session started. |
| `cursor` | `.agents/skills/discovery/` | Reads `.agents/skills` and `.cursor/skills`, plus `.claude/skills` and `.codex/skills` as third-party locations. Invoke `/discovery` in Agent chat or let Cursor select it.              |

Codex and Cursor share one `.agents/skills` copy. Choosing `claude` with either of the others writes a second,
byte-identical copy to `.claude/skills`. Cursor still lists `discovery` once: when a skill name exists in several
locations it keeps one, preferring `.cursor/skills`, then `.claude/skills`, then `.agents/skills`. With **Settings →
Rules, Skills and Subagents → Include third-party Plugins, Skills, and other configs** turned off, the Cursor editor
ignores `.claude/skills` and uses the `.agents` copy. Checked with Cursor 3.22.12 and `cursor-agent` 2026.09.28;
older Cursor versions were reported to list such duplicates separately.

After installing, check that each agent lists the skill; a successful copy does not by itself show that the agent
loaded it. Commit the installed directories when the team, fresh checkouts, cloud agents, or CI workers need them.

Try this task:

> Use the discovery skill to inspect this application's configuration, select a small system boundary, and run a
> Capsule investigation. Explain the command results and runtime evidence, preserve a report, and stop the Capsule.

The skill does not install Blackbox, grant execution permissions, or make planned Playwright/effect APIs available.

## Results, repeats, and updates

Every run reports each destination with one outcome: one `<agent>: <outcome> <path>` line per selected agent. With
`--json`, stdout carries one `skill-install` document with `ok`, `skill`, `version`, `source` (package and version),
`projectDirectory`, `results` (one per agent: `kind`, `agent`, absolute `path`), and `destinations` (one per directory:
project-relative `path`, `agents`, `outcome`, `version`, `from`, `reason`, `message`, `changes`).

| Destination before the run                                       | Outcome                                                            | What is written                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------ |
| Absent                                                           | `installed`                                                        | The complete skill and its record    |
| Installed by Blackbox, unmodified, same version and content      | `unchanged`                                                        | Nothing                              |
| Installed by Blackbox, unmodified, another version or content    | `updated` (`from` the recorded version)                            | The complete skill and its record    |
| A copy without a record whose files match this version           | `adopted`                                                          | The record; files kept byte for byte |
| Installed by Blackbox, then a file was edited, added, or removed | `conflict`, reason `locally-modified`                              | Nothing; `changes` lists each file   |
| Anything else already there (other files, a file, another skill) | `conflict`, reason `not-installed-by-blackbox`                     | Nothing                              |
| Unreadable/unwritable, or reached through a symlink              | `failed`, reason `permission-denied`, `unsafe-path`, or `io-error` | Nothing                              |
| Changed by someone else while the command was running            | `failed`, reason `changed-during-install`                          | Nothing; rerun to reassess it        |

The command exits `0` when every destination is `installed`, `updated`, `unchanged`, or `adopted`, and `1` when any is
a conflict or failed; the other destinations are still processed and reported. Blackbox never replaces a conflicting
directory. Review it, move or remove it, and rerun.

Blackbox records what it installed in `.blackbox-install.json` inside the skill directory: the installer package,
skill name, version, and a SHA-256 hash of every file. The record has no timestamps or absolute paths, so it can be
committed and teammates' reruns report `unchanged`. Line endings are normalized before hashing, so a Windows
checkout that converts to CRLF is not a local edit.

**Update policy:** the installed skill should match the Blackbox version the project uses. After upgrading
`@suites/blackbox-skills`, rerun the same command. Unmodified installations update in place; edited ones are reported
with the changed files and left alone. Nothing is updated in the background, and there is no moving remote source to
track.

## Installer decisions

| Decision              | Choice                                                                                                                                                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent selection       | Explicit: `--codex`, `--claude`, `--cursor`, or repeated `--agent`; `--yes` or the terminal prompt selects all three. Blackbox does not guess agents from files in the repository.                                                                 |
| Destinations          | Project scope only: `.agents/skills/discovery/` (Codex, Cursor) and `.claude/skills/discovery/` (Claude Code). No global or user-level installation.                                                                                               |
| Copy versus symlink   | Independent copies. Some `cursor-agent` builds skipped symlinked skills, older Cursor versions listed symlinked duplicates separately, and symlinks are unreliable on Windows checkouts. Both copies are kept byte-identical.                      |
| Multi-host duplicates | Only the distinct directories needed by the selected agents are written, and Cursor shares Codex's `.agents/skills` copy, which it reads natively. Current Cursor lists a skill name once even when `.claude/skills` holds a second copy.          |
| Project root          | The current working directory. The command does not search parent directories or the Git root.                                                                                                                                                     |
| Installed name        | `discovery`, the skill's `name` and folder name as the Agent Skills specification requires.                                                                                                                                                        |
| Source                | The tree packed in `@suites/blackbox-skills` (`assets/discovery/`). Nothing is downloaded, and no skill script is executed.                                                                                                                        |
| Conflicts             | Never overwritten. A matching copy without a record is adopted; anything else is reported for the user to move or remove.                                                                                                                          |
| Safety                | Every directory on the path must be a real directory inside the project; symlinks are refused, never followed. A new tree is staged beside the destination and swapped in by rename, so an interrupted install leaves the previous skill in place. |

### What existing projects teach us

| Maintained project                                       | Approach                                                                                                                                                                                     | Blackbox decision                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Vercel skills](https://github.com/vercel-labs/skills)   | A general installer: explicit agent selection, project or global scope, a canonical copy symlinked into each agent's directory (or `--copy`), and update tooling that tracks remote sources. | Keep explicit agent selection and the same per-agent directories (`.agents/skills`, `.claude/skills`). Use copies instead of symlinks, and take content from the versioned Blackbox package rather than a remote source that moves independently of the project's Blackbox version. |
| [Anthropic skills](https://github.com/anthropics/skills) | Portable skill directories that keep references and assets together, with plugin marketplaces as a separate distribution channel for Claude Code.                                            | Install the whole directory so relative references work, and keep plugin or marketplace distribution out of scope for the project installer.                                                                                                                                        |

A general-purpose installer optimizes for many skills from many sources. Blackbox ships one skill whose instructions
describe a specific Blackbox version, so the skill travels inside a versioned Blackbox package: installing it needs no
network, the version is the package's version, and an update happens only when the project upgrades and reruns the
command. Global installation, arbitrary remote skill sources, plugin marketplaces, and more hosts are outside this first
version. These are Blackbox scope decisions, not requirements of the shared skill format.

## Install manually

To install from a source checkout instead, complete [source installation](installation.md), retaining the
`blackbox_checkout` variable, and copy the complete directory into the destination for your agent. This example
refuses to replace an existing destination, including a dangling symlink:

```sh
skill_target=.agents/skills/discovery   # .claude/skills/discovery for Claude Code
if [ -e "$skill_target" ] || [ -L "$skill_target" ]; then
  printf 'Skill destination already exists: %s\n' "$skill_target" >&2
else
  mkdir -p "$(dirname "$skill_target")"
  cp -R "$blackbox_checkout/packages/skills/assets/discovery" "$skill_target"
fi
```

A later `skills install` run adopts an unmodified manual copy of the same version by adding its record.

## Maintain one portable source

Keep the skill's purpose and trigger description in its frontmatter. Put longer, task-specific procedures in references
and keep links relative to the installed directory. Platform-specific metadata may improve a host's presentation or
invocation controls, but it must not become necessary to understand the common instructions.
The [Agent Skills specification](https://agentskills.io/specification) defines the shared format and progressive loading.
`packages/skills/assets/discovery/` is the only source.

See the current [Codex](https://learn.chatgpt.com/docs/build-skills), [Claude Code](https://code.claude.com/docs/en/skills),
and [Cursor](https://cursor.com/docs/skills) documentation for discovery, invocation, nested directories, and remote
behavior. Research checked on 2026-09-29. Recheck the linked primary sources when changing host support.
