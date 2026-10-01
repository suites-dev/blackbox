# Package skill routing

The CLI composition root loads ESM skill contributions only from the consumer's
selected Blackbox plugins. The skill registry is scoped to that CLI invocation.
TypeScript module augmentation describes names; it cannot install or enable them.
Discovery is owned by `@suites/blackbox-discovery/skills/discovery`, Capsule by
`@suites/blackbox-capsule/skills/capsule`, and Catalog by
`@suites/blackbox-catalog/skills/catalog`. These ESM exports identify the owning
package's portable content. The generic Skills package knows none of these names.

| Work                                                         | Owner     | Missing integration                                                               |
| ------------------------------------------------------------ | --------- | --------------------------------------------------------------------------------- |
| Inventory, boundary, reconciliation, audit                   | discovery | Core route                                                                        |
| Catalog authoring and semantic validation                    | catalog   | Preserve inventory and proposed boundary; report authoring/validation unavailable |
| Live execution, async witness, observations, report, cleanup | capsule   | Complete static work; report requested live stages blocked                        |

Use `blackbox skills list --json` to inspect contributions from selected packages,
then the agent's available-skill list to establish which instructions are installed.
A listed contribution is installable; it does not mean the agent has loaded it.
An old on-disk skill is not proof that its source plugin remains selected.

`blackbox skills install discovery --codex` installs Discovery and its required
dependencies only. Catalog and Capsule are optional integrations and require
explicit selection, for example `blackbox skills install capsule --codex` when
the Capsule plugin is already selected. The installer never downloads packages.

For a Catalog handoff, supply the accepted boundary, evidence, existing assets and
authorized edits. Require the selected entry, changed paths, schema identity and
static validation result back. For Capsule, supply the entry, accepted predicate,
initial state, unique attempt/business identity, deadlines, observation needs and
authorized execution scope. Require actual session/activity IDs, independent
terminal/observation outcomes, screened artifact references and cleanup status.
Keep source inference separate from returned runtime evidence.

If Capsule is absent, say: "I don't have the Capsule skill in the selected packages."
If its package is available but the agent copy is missing, explain that distinction
and offer the explicit `blackbox skills install capsule --codex` command for Codex
(or the selected host flag). Never treat a stale copied skill as an installed runtime.

An unavailable optional integration does not invalidate completed static work.
For an inventory task, live stages may be not-required; for a requested exercise,
they are blocked, never passed or silently omitted.
