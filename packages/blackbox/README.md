# `@suites/blackbox`

The default Blackbox composition: core modules and the portable `$blackbox` agent
skill. Install `@suites/blackbox-cli` explicitly for the `blackbox` command, then
add execution adapters only when you need them.

## Install

This package is prepared for the alpha release but is not published to npm yet.
Until it is released, use the [source installation](../../docs/installation.md#build-from-source).
The release installation model is:

```sh
npm install --save-dev @suites/blackbox@next @suites/blackbox-cli@next
# Optional: choose either or both execution adapters.
npm install --save-dev @suites/blackbox-capsule@next @suites/blackbox-playwright@next
```

Prereleases use the `next` distribution tag. Use your project's package manager
and compatible Blackbox versions. Node 22.15+
is required; Docker is needed for Compose-backed execution, not skill installation
or static discovery. Runtime instrumentation and project drivers are separate
choices; see [installation](../../docs/installation.md).

| Included dependency          | Responsibility                                           |
| ---------------------------- | -------------------------------------------------------- |
| `@suites/blackbox-cli`       | Generic command host and module composition              |
| `@suites/blackbox-skills`    | Package-neutral registry and project-local skill copying |
| `@suites/blackbox-catalog`   | Project topology, validation, and Catalog skill          |
| `@suites/blackbox-discovery` | Discovery skill and its executable investigation helpers |

This package has no `bin` or launcher. Although CLI is a runtime dependency,
declare it directly in your project to expose its command through the package
manager; do not depend on transitive binary hoisting.

Capsule, Playwright, Sandbox, and runtime instrumentation are not dependencies of
this package. Execution adapters own the runtime packages they need. Installing
the main package alone does not expose Capsule commands or its skill.

## Start with the agent skill

From the target project, use its installed executable (for example,
`pnpm exec blackbox`):

```sh
blackbox --help
blackbox skills list --json
blackbox skills install blackbox --codex --gitignore
```

The base installation lists `blackbox`, `catalog`, and `discovery`. The last command
copies only `blackbox` into `.agents/skills/blackbox/`. Select `--cursor` for that
same location or `--claude` for `.claude/skills/blackbox/`. `--gitignore` is optional
and adds only successful skill destinations. Once the host discovers the copy,
invoke `$blackbox` in Codex; it explains the product and routes to available
specialists. The installer does not refresh the host.

Copy specialist skills separately when wanted:

```sh
blackbox skills install discovery --codex
blackbox skills install catalog --codex
# Available only when @suites/blackbox-capsule is selected and installed:
blackbox skills install capsule --codex
```

Package installation and skill copying are different operations. The command
never downloads missing packages. Rerun after upgrading packages to update
unmodified copies; locally edited copies are preserved as conflicts. See
[agent skills](../../docs/agent-skills.md) for records, versions, and all outcomes.

## Composition and public exports

`package.json` installs the core dependencies. The `blackboxModule` ESM export
explicitly activates Catalog, Discovery, and Skills. The separately installed CLI
discovers this composition from the consumer's dependencies. Third-party modules can use the same
[module contract](../cli/README.md#contribute-a-module).

| Public export                                   | Content                                        |
| ----------------------------------------------- | ---------------------------------------------- |
| `@suites/blackbox` or `@suites/blackbox/module` | `blackboxModule` composition descriptor        |
| `@suites/blackbox/skills`                       | `skillModule` and `blackboxSkill`              |
| `@suites/blackbox/skills/blackbox`              | The same skill descriptor for direct consumers |

Resolve portable content through `blackboxSkill.source`, not guessed filesystem
paths. This package owns `skills/blackbox/`; the generic Skills package owns no
concrete skills. Specialist APIs remain in their owning packages, not re-exported
through this entry point.

## Validate

After a frozen workspace install and `pnpm build`, from the repository root:

```sh
pnpm --filter @suites/blackbox test
pnpm test:e2e:skills
```

The packed test installs the main package and CLI as direct dependencies and checks
CLI executable ownership, the absence of a main-package launcher, default commands
and skills, all host destinations, and absent adapters. Registry-consumer E2E lanes
add explicitly selected Capsule, Playwright, driver, and Node instrumentation adapters.
