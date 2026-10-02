# `@suites/blackbox-discovery`

Discovery owns the portable Discovery skill and its executable audit, boundary
and permission helpers. It depends on the generic Skills contracts, not on Capsule
or Catalog.

## Install the instructions

Select this package alongside `@suites/blackbox-cli` and
`@suites/blackbox-skills` in your project's dependencies, then run:

```sh
blackbox skills list --json
blackbox skills install discovery --codex --gitignore
```

The command copies [the complete skill](skills/discovery/SKILL.md) to
`.agents/skills/discovery`, preserving relative references. Omit `--gitignore`
to commit the copy. Rerun after upgrading the package; user edits are conflicts,
never silently replaced. See [installation details](../../docs/agent-skills.md).

Catalog and Capsule are optional integrations, not automatic dependencies.
Missing packages contribute no skills. Discovery completes applicable static work
and explains unavailable live stages instead of claiming they ran.

## Public ESM exports

| Export                                        | Contract                                                   |
| --------------------------------------------- | ---------------------------------------------------------- |
| `@suites/blackbox-discovery`                  | Domain types and pure executable helpers                   |
| `@suites/blackbox-discovery/skills`           | `skillModule` contribution and `discoverySkill` descriptor |
| `@suites/blackbox-discovery/skills/discovery` | Same descriptor for direct skill consumers                 |

Consumers resolve content through `discoverySkill.source`, never by guessing
package internals. The CLI loads `skillModule` only when the package is selected;
its TypeScript augmentation alone does not register anything at runtime.

The main `@suites/blackbox` package includes Discovery by default. Discovery is a
skill/domain provider, not an empty oclif plugin. Its Catalog and Capsule skill
integrations remain optional: listing a route does not install or activate it.

## Executable helpers

```ts
import { validateAudit } from '@suites/blackbox-discovery';

const result = validateAudit(auditDocument, receiptDocument);
if (result.kind === 'rejected') {
  console.error(result.diagnostics);
}
```

`validateAudit` validates the bundled schemas, evidence graph and receipt links.
Acceptance is explicitly `structure-and-receipt-links-only`, not authenticated
runtime proof. `validateInspectorResult` checks inspector fragments.
`proposeBoundary` and `dependencyClosure` conservatively retain required
prerequisites; they do not prove behavioral equivalence. `authorize` checks
action/scope/time against caller-authenticated approvals; it grants no authority
by itself.

No Discovery command executes experiments, normalizes receipts or authenticates
provenance. Capsule execution remains in the Capsule package.

## Validate

```sh
pnpm --filter @suites/blackbox-discovery lint
pnpm --filter @suites/blackbox-discovery test
```
