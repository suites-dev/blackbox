# Editable Playwright scaffolds: the project-owned path

Part of [design proposals](../design/README.md). Check [availability](../alpha-status.md) for implemented capabilities.

**Proposed generator, not a shipped command.** Native Playwright authoring already works without it.
Some accepted behaviors need SDK operations or observers outside the supported Feature vocabulary.
A scaffold would give the agent a starting structure for that project-owned test.

## Two distinct authoring contracts

| Deterministic Feature compilation                         | Editable scaffold — planned                                           |
| --------------------------------------------------------- | --------------------------------------------------------------------- |
| Complete native suite for supported sentences             | Starting structure for project-specific implementation                |
| Generated output stays unedited                           | Agent/developer owns and edits the TypeScript                         |
| Byte-level Feature-to-suite drift validation              | Review against source expectations; no compiler equivalence guarantee |
| Implemented in the candidate revision, not on this branch | No final CLI name or implemented generator                            |

Both can participate in the [behavioral contract](../contracts/README.md): reviewed
scenarios, output/state assertions, and an accepted effects baseline. The baseline is a separate
expectation artifact, not editable generated test code. No snapshot binding API is introduced here.

## What the agent should learn in a Capsule

Establish the actual entrypoint, initial state, business identity, actions and observations needed
by the requirement. For the cache rule, distinguish a stored Redis value from evidence that the
application avoided PostgreSQL during retrieval. Inspect the experiment's report and limitations.

The final test must establish those conditions and observations in its **own fresh Sandbox**. It
must not reuse a successful Capsule response or accept every recorded effect as normative.
[Capsule workflow](../guides/investigate-with-capsule.md).

## A fail-closed starting structure

This is illustrative project-owned TypeScript, not output from a released scaffold command:

```ts
import { test } from '@suites/blackbox-playwright';

test.system('product-system', (system) => {
  system.sandbox('default', (suite) => {
    suite.test('serves a valid cache hit without PostgreSQL', async ({ sandbox }) => {
      // Establish initial state and a reliable observation of database reads.
      void sandbox;
      throw new Error('Unimplemented verification: cache-hit PostgreSQL absence');
    });
  });
});
```

Missing required assertions must not become an empty passing test. The agent fills in the checks
against the accepted requirement. Recording effects is not a substitute for
implementing output/state assertions or approving a baseline.

## How traceability should work

Keep the source specification and reviewed scenario visible. Preserve setup, action and assertion
boundaries; give unfinished checks an explicit failure. Do not claim that byte-level Feature drift
can validate arbitrary edited TypeScript. Changes to baseline selection or assertions need review.
The exact scaffold and snapshot association are still implementation decisions.

## When to use each path

Compile when the vocabulary expresses the requirement. Author native TypeScript when richer code
is needed. Gherkin is optional; the accepted behavior remains the common authority.

[Native Playwright](README.md) · [Feature compilation](../features/generating-test-suites.md) ·
[Reviewing baseline changes](../contracts/reviewing-changes.md)
