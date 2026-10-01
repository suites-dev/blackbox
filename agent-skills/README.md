# Blackbox agent skills

Blackbox is unpublished. Check the [current implementation status](../docs/alpha-status.md)
and [CLI reference](../docs/cli.md) before executing a workflow from these references.
Playwright and effect-evaluation references are labeled design guidance for later stages.
See [agent skill setup](../docs/agent-skills.md) for installation with `blackbox skills install discovery` or by hand. Start with the [local quickstart](../docs/getting-started.md) to try the current implementation.

## Installable Alpha skill

[`packages/discovery/skills/discovery`](../packages/discovery/skills/discovery/) is the portable Alpha onboarding entrypoint, shipped in `@suites/blackbox-discovery`. Install it with `blackbox skills install discovery`, or copy the complete directory to a skill location supported by the agent host. Its `SKILL.md` and all supporting references stay together, so the installed copy has no links back to this repository or the historical source bundle.

The entrypoint progressively routes among references for topology and catalog authoring, runtime observation, Capsule experiments, native Playwright, asynchronous workflows, effects and baselines, evidence and reports, troubleshooting and repair, and CI. Read only the reference needed for the current task.

## Provenance

[`source-dispositions.json`](source-dispositions.json) records the disposition and SHA-256 for every one of the 29 historical skill sources, pinned to the import inventory at commit `732ecf29e42214a4fd436889dc8898f169335bae`. It records all 22 active sources and seven deferred sources. Historical source content is provenance, not product authority or an install-time dependency.

Skills are installed into a project only, never into an operator's global configuration; see [agent skill setup](../docs/agent-skills.md) for destinations and update behavior.
