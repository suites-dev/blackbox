# Investigate with a Capsule, confirm with Playwright

A Capsule is the agent's laboratory: prepare a bounded real system, act through its interfaces,
inspect the results, and refine a hypothesis. Use it before the final test when observations are
unclear or after a failure needs investigation. Known systems can go straight to Playwright.

![Capsule experiments inform candidate expectations; review preserves the accepted behavior before repeatable verification.](../assets/readme/capsule-to-feature.svg)

## Make the question smaller

For a cached product, ask whether one retrieval reads PostgreSQL despite a valid cached value.
Keep the product API, Redis, PostgreSQL, and the necessary observer. Remove unrelated services only
when doing so preserves the behavior and evidence. Record external or substituted participants.

This is Blackbox's application of [narrowing difficult verification problems](https://www.kipiiler.me/blog/verification-systems-llms-ai-agents).
Discovery finds a useful boundary; it does not prove behavioral equivalence with production.
Reuse a suitable Catalog entry and clients rather than making a new stack for every spec.

![Configuration selects the real participants, action and inspection drivers, and supported runtime instrumentation.](../assets/readme/system-boundary.svg)

## Run an experiment

In a configured checkout, use supported command families and the actual session ID from startup:

```sh
pnpm exec blackbox capsule up <system-id> --json
pnpm exec blackbox capsule run --session <session-id> -- <command...>
pnpm exec blackbox capsule show <session-id>
pnpm exec blackbox capsule down <session-id>
pnpm exec blackbox capsule report serve --session <session-id> --open
```

Capture activity IDs too. Establish initial state, issue the stimulus, inspect the required outcome,
and record completion and capture limits. Do not guess the latest session or repeat a non-idempotent
action merely to make the result pass. Ensure owned resources are cleaned up even when a command or
report fails. Stopping retains the experiment's records.

The [operational reference](../../packages/capsule/skills/capsule/references/capsule-experiments.md)
describes identities, propagation, raw command results, and cleanup. The HTML and JSON report expose
observations, not automatic approval of expected behavior. A drained collector is not proof that
every library was instrumented.

## What a Capsule does not execute

Capsule currently runs commands and drivers, **not a `.feature` test suite**. The agent can rehearse
a reviewed Given/When/Then scenario using those tools, but must keep its assessment separate from
recorded runtime facts. It must not describe proposed effects evaluators as shipped.

## From an observation to an accepted check

The accepted spec determines whether the result is right. The planned snapshot workflow can propose
selected effects as a candidate baseline. Capture alone does not make those interactions normative.
Review the intended meaning and any newly introduced constraints before acceptance.

A snapshot should not freeze private function calls, transient IDs, or unrelated telemetry. Equally,
normalization must not discard the interaction the requirement is supposed to constrain.
[Effects snapshot design](../contracts/effects-snapshots.md).

The final native or generated Playwright suite creates **its own fresh Sandbox, initial state, and
evidence**. It does not inherit a successful Capsule attempt or use that observation as its fresh
verification result. Cross-tool candidate promotion is not specified as an implemented capability.

## Keep verification cheap enough to repeat

The point of the experiment is to make a useful repeatable check—not to investigate forever.
Reuse accepted expectations and suitable setup for subsequent implementations. This applies
[the asymmetry of verification](https://www.jasonwei.net/blog/asymmetry-of-verification-and-verifiers-law)
without promising that every distributed-system property is cheap or fully observable.

[Full workflow](from-spec-to-verification.md) · [Reports](reports.md) ·
[Review candidate effects](../contracts/reviewing-changes.md) · [Repair exercise](repair-from-evidence.md)
