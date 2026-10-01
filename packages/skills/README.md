# `@suites/blackbox-skills`

`@suites/blackbox-skills` owns Blackbox's package-neutral skill contracts,
registry, project installer, and the Discovery skill. Feature packages keep their
own operational knowledge and contribute it through ESM skill modules.

## Package composition

Each contributing package exports a `skillModule` from its public `./skills`
subpath and declares that export in `package.json`:

```json
{
  "blackbox": {
    "skills": { "apiVersion": 1, "export": "./skills" }
  }
}
```

The CLI composition root loads this entrypoint only from the oclif plugins selected
for that invocation. It passes those contributions to the Skills commands through
the CLI contract's per-config context. The registry itself never scans, downloads,
or imports packages.

This separation is intentional:

- `@suites/blackbox-skills` contributes `discovery`.
- `@suites/blackbox-catalog` contributes `catalog`.
- `@suites/blackbox-capsule` contributes `capsule`.
- An unselected feature package contributes nothing at runtime.

Feature packages augment `SkillRegistry` from their ESM entrypoints so consumers
can see their known skill names at compile time. Module augmentation does not make a
skill available at runtime; the selected plugin contribution remains authoritative.

## Dependencies and integrations

A skill definition distinguishes required `dependencies` from optional
`integrations`. Installing a skill resolves and installs its required dependency
closure. Integrations are shown by `blackbox skills list --json`, but are never
traversed or installed automatically.

Discovery uses this distinction to remain useful without runtime packages. It owns
static inventory and audit guidance, and routes optional catalog authoring or live
Capsule work only when those skills are available.

## Public exports

- `@suites/blackbox-skills` exports the registry, installer, and contracts.
- `@suites/blackbox-skills/skills` exports this package's `skillModule`.
- `@suites/blackbox-skills/discovery` exports the Discovery definition directly.

The installer validates complete skill trees, rejects unsafe paths and links,
records file hashes and package versions, and publishes each replacement through
a staged atomic swap. It reports conflicts without overwriting a different or
locally modified installed skill.

## Validate changes

From the repository root:

```sh
pnpm --filter @suites/blackbox-skills lint
pnpm --filter @suites/blackbox-skills build
pnpm --filter @suites/blackbox-skills test
```

Changes to discovery, registration, installation, fixtures, or assertions also
require the repository's test-qualification workflow.
