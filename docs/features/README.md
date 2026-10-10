# Review the behavior, then execute it

The product specification requires creation to persist a product in PostgreSQL
and cache it in Redis. A subsequent cached retrieval must avoid PostgreSQL. A
Feature gives the developer and coding agent a shared place to review those
expectations before running them.

Blackbox adopts Gherkin through Cucumber's parser and generates native Playwright
suites from supported sentences. Feature files are optional. You can express the
same accepted behavior directly in [native Playwright](../playwright/README.md).

<p align="center">
  <img width="800" src="../assets/readme/specification-triangle.svg" alt="The accepted product specification guides a reviewed optional Feature. Generation preserves its rule, scenarios, and Arrange–Act–Assert structure in Playwright. Execution checks PostgreSQL persistence, Redis state, and cache-hit behavior." />
</p>

Begin with [the product verification walkthrough](../guides/verify-a-specification.md).
At scenario review, follow [the Feature authoring path](drafting-feature-files.md),
then return to its shared evidence and [implementation repair](../guides/repair-from-evidence.md).
The application, rule, and evidence stay the same whichever authoring path you use.

## Keep the specification connected to the system

Three checks maintain different relationships:

| Check                                                       | What it establishes                                                        |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| Review the scenarios against the accepted specification     | The executable expectations preserve the intended behavior.                |
| Generate and [check suite drift](generating-test-suites.md) | The generated file still matches the reviewed Feature and compiler inputs. |
| Run the suite and inspect the evidence                      | This execution satisfied or violated those assertions.                     |

Repeated execution exposes departures from accepted behavior as implementation
evolves. Review still matters: a passing suite cannot establish that an arbitrary
prose specification is complete or that every clause was represented.

The current compiler has a [defined HTTP vocabulary](reference.md#sentence-reference).
The product example uses protected, project-owned HTTP endpoints to inspect
PostgreSQL and Redis. Use native tests when your observations need direct SDK calls
or other operations outside that vocabulary.

## Bring findings back to review

A [Capsule experiment](../../packages/capsule/skills/capsule/references/capsule-experiments.md)
can investigate a failure or explore a candidate expectation before it becomes
part of the specification. Observed behavior does not become accepted behavior
automatically: review the finding against the intended outcome, then express any
accepted change in the Feature or native suite.

<p align="center">
  <img width="800" src="../assets/readme/capsule-to-feature.svg" alt="A Capsule investigation leads to a candidate expectation, developer review, and an accepted Feature with its Playwright suite." />
</p>

The figure follows the optional Feature path. Native tests can carry the same
reviewed expectation into repeatable verification.

[Author the product Feature](drafting-feature-files.md) ·
[Maintain the generated suite](generating-test-suites.md) ·
[Language and compiler reference](reference.md)
