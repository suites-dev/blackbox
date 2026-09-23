# Blackbox agent skills

## Installable Alpha skill

[`skills/discovery`](skills/discovery/) is the portable Alpha onboarding entrypoint. Copy the complete directory to a skill location supported by the agent host. Its `SKILL.md` and all supporting references stay together, so the installed copy has no links back to this repository or the historical source bundle.

The entrypoint progressively routes among references for topology and catalog authoring, runtime observation, Capsule experiments, native Playwright, asynchronous workflows, effects and baselines, evidence and reports, troubleshooting and repair, and CI. Read only the reference needed for the current task.

## Provenance

[`source-dispositions.json`](source-dispositions.json) records the disposition and SHA-256 for every one of the 29 historical skill sources, pinned to the import inventory at commit `732ecf29e42214a4fd436889dc8898f169335bae`. It records all 22 active sources and seven deferred sources. Historical source content is provenance, not product authority or an install-time dependency.

This bundle does not install skills into an operator's global configuration or ship a Blackbox CLI installer. The Alpha skill installer destination and repeat/update behavior remain separate product contract work.
