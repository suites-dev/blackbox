# Repeat the accepted contract in CI

Local investigation and CI have different budgets, not different definitions of correct behavior.
Run focused scenarios during development; CI runs the broader scope selected by the repository.
Every physical Playwright attempt gets a fresh Sandbox. CPU, memory, containers and shared external
dependencies still limit useful concurrency.

## Keep the checks separate

| Check | What it answers |
| --- | --- |
| Review spec and scenarios | Are we checking the behavior people intended? |
| Validate Feature generation | Does the derived TypeScript match the reviewed Feature? |
| Execute output and state assertions | Did this actual attempt satisfy those expectations? |
| Compare effects with an accepted snapshot — planned | Did the observed interactions agree with the accepted runtime expectation? |

Generated-suite drift and effects differences are **not the same drift**. One compares source
artifacts; the other needs a real execution with adequate observation.

## Current candidate example commands

After integrating the typed clients/Feature compiler from PR #181 and the unpublished product-cache
sample, prepare its dependencies and Docker as described in the walkthrough. From `e2e/product-cache/`:

```sh
pnpm exec tsc --project tsconfig.json
pnpm exec blackbox feature suite validate tests/product-cache.feature \
  --clients tests/clients.ts --output tests/product-cache.generated.spec.ts
pnpm --dir .. exec playwright test --config product-cache/playwright.config.ts --project feature
```

For project-owned native tests, omit generated-suite validation and select `--project native`.
Honor the actual exit statuses and retain reports even when verification fails. Generating a suite
or rendering a report successfully is not proof that its scenarios ran.

## Planned snapshot policy

Normal CI should **compare accepted baselines, not update them**. A first recording is a candidate
for review, not automatic acceptance. Missing baselines, explicit opt-outs, changed observation
policy, and inadequate capture must be visible. The exact gate commands and status schema await
the snapshot implementation; this page adds no workflow or GitHub Action.

A retry is a new attempt. Keep its earlier failure visible. A focused subset, skipped test, or
unimplemented scaffold is not complete verification of the selected contract.

Start with one behavior. Reuse the system configuration, clients, and observations for further
scenarios; fresh Sandboxes do not require duplicate per-Feature configuration stacks. Existing
Playwright system tests are also an intended adoption path, not a promised one-command migration.

[Generated-suite maintenance](../features/generating-test-suites.md) ·
[Review changes](../contracts/reviewing-changes.md) · [Reports](reports.md)
