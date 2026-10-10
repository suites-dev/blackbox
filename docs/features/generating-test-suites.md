# Keep reviewed behavior in the suite you execute

Generated Playwright is **derived output**, not a second mutable source
of truth. If the reviewed Feature changes but TypeScript doesn't, CI may
still execute an obsolete scenario.

Keep three checks separate: source specification → expectations needs
**semantic review**; Feature → TypeScript needs a **deterministic drift
check**; executable expectations → implementation needs **runtime
execution**. This guide protects the middle relationship, then reruns
the last one.

Complete [the Feature path](drafting-feature-files.md) first. Keep commands in
`e2e/product-cache/`. Native tests use the same review, execution, and repair loop;
this generated-file check is additional work for the Feature authoring path.

![Review keeps the expected behavior aligned from the source spec through an optional Feature and its generated native suite.](../assets/readme/specification-triangle.svg)

A generated test is not the authority for changing requirements. If a
reviewed Feature changes, regenerate its suite rather than editing the
output by hand.

## Check for drift

```sh
pnpm exec blackbox feature suite validate tests/product-cache.feature --clients tests/clients.ts --output tests/product-cache.generated.spec.ts
```

A matching pair reports that the generated TypeScript matches the reviewed
Feature. Validation regenerates the TypeScript in memory and compares bytes.
It does **not** execute the system or establish whether the Feature captured
every requirement in the source specification.

Generated formatting is part of that comparison. Keep the generated suite outside
automatic formatting and make expectation changes in the reviewed source.

## Review a change before replacing the suite

For a small practice edit, refine the cached-retrieval Scenario title to include
`while the cache entry is valid`. Keep its requests and assertions unchanged.
The title now makes the accepted precondition visible in the report.

Run the drift command again. It must fail with `Generated suite has drifted`:
the reviewed source title and committed generated title no longer match.

For a behavior change, first review the source specification and its consequences.
A newly observed implementation behavior does not by itself authorize changing
the expected outcome.

## Generate a candidate, then execute it

Choose an unused candidate filename beside the existing suite:

```sh
pnpm exec blackbox feature suite emit tests/product-cache.feature --clients tests/clients.ts --output tests/product-cache.candidate.ts
```

Inspect the generated change. For the title edit, expect a changed scenario title
with the same two scenarios, hierarchy, preconditions, and assertions. Do not
replace the suite if unrelated expectations changed.

After accepting that generated change:

```sh
mv tests/product-cache.candidate.ts tests/product-cache.generated.spec.ts
pnpm exec tsc --project tsconfig.json
pnpm exec blackbox feature suite validate tests/product-cache.feature --clients tests/clients.ts --output tests/product-cache.generated.spec.ts
pnpm --dir .. exec playwright test --config product-cache/playwright.config.ts --project feature --list
pnpm --dir .. exec playwright test --config product-cache/playwright.config.ts --project feature
```

Discovery should still show two scenarios. Inspect the report to confirm that the
renamed scenario executed the same PostgreSQL and Redis expectations.

## Repeat the same checks in CI

With the test project prepared and Docker available, use the same
TypeScript check, suite validation, and Playwright invocation in CI. Keep the
compiler version consistent with local generation. The CI job must run the
selected scenarios; a successful generation command is not runtime verification.

| Check                           | Relationship protected                           |
| ------------------------------- | ------------------------------------------------ |
| Developer/agent review          | Accepted specification → executable expectations |
| Generated-suite drift check     | Reviewed Feature → generated TypeScript          |
| System test and evidence review | Executable expectations → running system         |

An implementation change repeats the [verification and repair loop](../guides/repair-from-evidence.md)
against unchanged expectations. An accepted behavior change updates the source
specification and scenarios together, then generates and executes the new suite.
