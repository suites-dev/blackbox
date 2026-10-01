# Use Blackbox with agent skills

Blackbox packages contribute portable agent skills through the same selected-plugin
composition used by the CLI. Discovery contributes `discovery`, Catalog
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

Each contribution is a portable `SKILL.md` directory with its supporting
references, packed inside its owning package at that package's version. Command
flags and output may still change while the
[CLI vocabulary issue](https://github.com/suites-dev/blackbox/issues/24) is open.

## Install the skill

The `skills` commands come from the `@suites/blackbox-skills` plugin. Add it to your project's dependencies next to
`@suites/blackbox-cli` and `@suites/blackbox-discovery`; the CLI loads Blackbox plugins listed in the nearest `package.json`. Add Capsule or Catalog only when needed. Then run the command from
your project's root directory, naming every agent your team uses:

```sh
blackbox skills install discovery --codex --claude
```

`--agent codex|claude|cursor` (repeatable) is equivalent to the per-agent flags, `--yes` selects all three, and in a
terminal without any agent flag the command asks before installing for all three. `blackbox skill install` is an alias.

| Agent    | Destination             | Discovery and invocation                                                                                                                                                              |
| -------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codex`  | `.agents/skills/<name>` | Scans `.agents/skills` from the working directory up to the repository root. Invoke `$<name>` or let Codex select it when relevant. Changes are picked up without a restart.          |
| `claude` | `.claude/skills/<name>` | Reads only `.claude/skills`, not `.agents/skills`. Invoke `/<name>` or let Claude select it. Start a new session if `.claude/skills/` did not exist when the current session started. |
| `cursor` | `.agents/skills/<name>` | Reads `.agents/skills` and `.cursor/skills`, plus `.claude/skills` and `.codex/skills` as third-party locations. Invoke `/<name>` in Agent chat or let Cursor select it.              |

Codex and Cursor share one `.agents/skills` copy. Choosing `claude` with either of the others writes a second,
byte-identical copy to `.claude/skills`. Cursor still lists `discovery` once: when a skill name exists in several
locations it keeps one, preferring `.cursor/skills`, then `.claude/skills`, then `.agents/skills`. With **Settings →
Rules, Skills and Subagents → Include third-party Plugins, Skills, and other configs** turned off, the Cursor editor
ignores `.claude/skills` and uses the `.agents` copy. Checked with Cursor 3.22.12 and `cursor-agent` 2026.09.28;
older Cursor versions were reported to list such duplicates separately.

After installing, check that each agent lists the skill; a successful copy does not by itself show that the agent
loaded it. Commit the installed directories when the team, fresh checkouts, cloud agents, or CI workers need them.
Alternatively, pass `--gitignore` to append exact successful destination paths to the current project's `.gitignore`:

```sh
blackbox skills install discovery --codex --gitignore
```

Existing rules remain intact; conflicting skill directories are not ignored. Copies remain locally invokable as
`$discovery` in Codex. Ignored copies must be reinstalled in new checkouts. This flag does not untrack already committed files.
An unsafe or unwritable `.gitignore` produces a failed result even if the skill copy succeeded.

Catalog and Capsule have the same portable layout under
`packages/catalog/skills/catalog` and `packages/capsule/skills/capsule`. Manual
copying does not change which CLI packages are installed or selected.

Try this static task with Discovery alone:

> Use the discovery skill to inspect this application's configuration, inventory
> its boundaries, and state which claims still require live runtime evidence.

With the Capsule skill also available, try:

> Use the discovery and capsule skills to select a small system boundary, run a
> bounded investigation, explain the runtime evidence, preserve a report, and stop
> the Capsule.

The skill does not install Blackbox, grant execution permissions, or make planned Playwright/effect APIs available.

## Results, repeats, and updates

Every run reports each destination with one outcome: one `<agent>: <outcome> <path>` line per selected agent. With
`--json`, stdout carries one `skill-install` document with `ok`, `skill`, `version`, `source` (package and version),
`projectDirectory`, `gitignore` (`outcome` and `message`), `results` (one per agent: `kind`, `agent`, absolute `path`), and `destinations` (one per directory:
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
a conflict or failed. Every destination for the current skill is processed and reported; a failed required skill stops
later skills in the dependency chain. A copy owned by a different source package conflicts with `source-package-mismatch`, even when its name and bytes match.
Older records without source ownership are adopted only when their complete contents match the current bundle.
Blackbox never replaces a conflicting directory. Review it, move or remove it,
and rerun.

Blackbox records what it installed in `.blackbox-install.json` inside the skill directory: the installer package,
source package, skill name, version, and a SHA-256 hash of every file. The record has no timestamps or absolute paths, so it can be
committed and teammates' reruns report `unchanged`. Line endings are normalized before hashing, so a Windows
checkout that converts to CRLF is not a local edit.

**Update policy:** each installed skill should match its owning Blackbox package version. After upgrading that package,
rerun the same command. Unmodified installations update in place; edited ones are reported with the changed files and
left alone. Nothing is updated in the background, and there is no moving remote source to track.

## Installer decisions

| Decision              | Choice                                                                                                                                                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent selection       | Explicit: `--codex`, `--claude`, `--cursor`, or repeated `--agent`; `--yes` or the terminal prompt selects all three. Blackbox does not guess agents from files in the repository.                                                                 |
| Destinations          | Project scope only: `.agents/skills/<name>/` (Codex, Cursor) and `.claude/skills/<name>/` (Claude Code). No global or user-level installation.                                                                                                     |
| Copy versus symlink   | Independent copies. Some `cursor-agent` builds skipped symlinked skills, older Cursor versions listed symlinked duplicates separately, and symlinks are unreliable on Windows checkouts. Both copies are kept byte-identical.                      |
| Multi-host duplicates | Only the distinct directories needed by the selected agents are written, and Cursor shares Codex's `.agents/skills` copy, which it reads natively. Current Cursor lists a skill name once even when `.claude/skills` holds a second copy.          |
| Project root          | The current working directory. The command does not search parent directories or the Git root.                                                                                                                                                     |
| Installed name        | The selected contribution's `name`, used as the folder name as the Agent Skills specification requires.                                                                                                                                            |
| Source                | The tree packed in the selected contributing package. Nothing is downloaded, and no skill script is executed.                                                                                                                                      |
| Conflicts             | Never overwritten. A matching copy without a record is adopted; anything else is reported for the user to move or remove.                                                                                                                          |
| Safety                | Every directory on the path must be a real directory inside the project; symlinks are refused, never followed. A new tree is staged beside the destination and swapped in by rename, so an interrupted install leaves the previous skill in place. |

### What existing projects teach us

| Maintained project                                       | Approach                                                                                                                                                                                     | Blackbox decision                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Vercel skills](https://github.com/vercel-labs/skills)   | A general installer: explicit agent selection, project or global scope, a canonical copy symlinked into each agent's directory (or `--copy`), and update tooling that tracks remote sources. | Keep explicit agent selection and the same per-agent directories (`.agents/skills`, `.claude/skills`). Use copies instead of symlinks, and take content from the versioned Blackbox package rather than a remote source that moves independently of the project's Blackbox version. |
| [Anthropic skills](https://github.com/anthropics/skills) | Portable skill directories that keep references and assets together, with plugin marketplaces as a separate distribution channel for Claude Code.                                            | Install the whole directory so relative references work, and keep plugin or marketplace distribution out of scope for the project installer.                                                                                                                                        |

Blackbox ships a bounded set of package-owned skills whose instructions describe
their package version. Installing them needs no network, and an update happens only
when the project upgrades an owning package and reruns the command. Global
installation, arbitrary remote skill sources, plugin marketplaces, and more hosts
remain outside this version. These are Blackbox scope decisions, not requirements
of the shared skill format.

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
  cp -R "$blackbox_checkout/packages/discovery/skills/discovery" "$skill_target"
fi
```

A later `skills install` run adopts an unmodified manual copy of the same version by adding its record.

## Maintain one portable source

Keep the skill's purpose and trigger description in its frontmatter. Put longer, task-specific procedures in references
and keep links relative to the installed directory. Platform-specific metadata may improve a host's presentation or
invocation controls, but it must not become necessary to understand the common instructions.
The [Agent Skills specification](https://agentskills.io/specification) defines the shared format and progressive loading.
The owning package's `skills/<name>/` directory is the only source for each skill.

See the current [Codex](https://learn.chatgpt.com/docs/build-skills), [Claude Code](https://code.claude.com/docs/en/skills),
and [Cursor](https://cursor.com/docs/skills) documentation for discovery, invocation, nested directories, and remote
behavior. Research checked on 2026-09-29. Recheck the linked primary sources when changing host support.
