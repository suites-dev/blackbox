# Spec-Driven Verification

**Spec-Driven Verification** means checking a running implementation against *accepted behavioral expectations derived from a specification*. It complements Spec-Driven Development (SDD), but does not replace the work of discovering, clarifying, or approving requirements.

An accepted specification might be Markdown, a ticket, acceptance criteria, an API contract, or an artifact maintained by Spec Kit or another SDD workflow. **Blackbox does not have to own that file to verify the behavior it describes.**

## The source of truth is intent, not code shape

```text
   Human intent / accepted specification
                    |
             behavioral claims
                    |
                 review
                    |
          executable expectations
            /              \
    Native Playwright    Gherkin Feature
            \              /
             selected system
                    |
            isolated execution
                    |
           outcomes / state /
              runtime effects
                    |
             qualified finding
                    |
        agent investigates / repairs
                    |
              same test reruns
```

The developer or organization's review process owns the accepted behavior. The agent may propose tests, clarifications, repairs, or changes to requirements, but a failing implementation is not permission to silently weaken the expectation.

Blackbox owns **verification infrastructure**: system discovery and selection, managed environment setup, Sandbox lifecycle, action/observation clients, retained diagnostics, native Playwright integration, and available evidence sources.

## Two different correctness questions

**Specification adequacy:** Does the accepted document faithfully capture
the intended business rules, conditions, constraints, and important edge
cases? This is a requirements and review problem. Tests derived from the
same flawed specification cannot, by themselves, reveal every missing rule.

**Implementation conformance:** Does the running system satisfy the
specific accepted behaviors expressed by executable checks under their
observed conditions? Blackbox provides infrastructure and evidence for
this second question.

These are coupled but not interchangeable. A perfect run against
incomplete expectations does not establish that the product is correct;
a failing run does not by itself prove the original specification
should be changed.

## Break a specification into claims

The accepted [product-cache rule](../guides/verify-a-specification.md) says:

> Creating a product persists it in PostgreSQL and populates Redis. Retrieving it while cached must use Redis without reading PostgreSQL.

That statement has several separately checkable claims:

| Claim | Evidence required | Why the response alone is insufficient |
| --- | --- | --- |
| Creation persisted the product | Expected row read through a separate connection after the operation | A successful status could precede rollback or an incorrect write |
| Creation populated Redis | Expected cached value read from Redis | Returning the product doesn't show its cache state |
| Retrieval avoided PostgreSQL | Calibrated, bounded application SQL and Redis observations | Correct JSON can come from a bypassed cache |

The agent can **derive candidate claims** and propose a test for each, but no compiler can infer that it captured every nuance of arbitrary human prose. Human review remains necessary.

See [how Blackbox qualifies evidence](behavioral-evidence.md).

## Make expectations executable

There are two first-class authoring options:

**Native Playwright** uses ordinary TypeScript, registered SDK clients, and assertions inside the selected Blackbox Sandbox. It needs no Gherkin file.

**Optional Gherkin** provides a readable `Feature → Rule → Scenario` structure that can be reviewed separately from code. Its supported sentences compile to native Playwright and must be validated; unsupported semantics should fail rather than disappear.

Gherkin is especially compatible with an SDD workflow in which specifications and their concrete examples are reviewed artifacts. It is more than an arbitrary syntax option, **but it isn't an authority to change the underlying requirement**.

[Write native tests](../playwright/README.md) · [Work with Features](../features/README.md)

## Three different relationships need verification

| Relationship | Question | How it is checked |
| --- | --- | --- |
| **Specification → executable expectations** | Do these scenarios faithfully represent the accepted requirements, including important edge cases? | Review, traceability, clarification; *not* a deterministic hash check |
| **Feature → generated Playwright suite** | Does the TypeScript still match the reviewed Feature and compiler inputs? | Deterministic generated-suite drift check |
| **Executable expectations → running implementation** | Did this particular attempt satisfy the authored assertions? | Playwright results and claim-appropriate evidence |

An automated Feature drift check is valuable but cannot say whether the human specification is complete. Likewise, passing all executed tests establishes *their* assertions under recorded conditions; it does not constitute a proof of every possible behavior of the application.

[Generated-suite maintenance](../features/generating-test-suites.md) · [Evidence-led repair](../guides/repair-from-evidence.md)

## Claims determine the evidence

Some specs require only a response; some require a durable state change or downstream processing. Some explicitly forbid an operation. The accepted claim defines what to measure, when it is complete, and where observation is required.

For the negative cache-hit claim, the product example first demonstrates that the observation mechanism can detect a known PostgreSQL query, and then measures the one retrieval in a bounded interval. The calibration matters more than simply counting missing OpenTelemetry spans.

When a required observation is unavailable, the claim may be **unresolved** despite a passing response assertion. This is a way to reason about sufficiency, **not a claim that the present alpha automatically emits three-valued verdicts for all runtime effects**.

[Behavioral evidence](behavioral-evidence.md) · [Redis observation](../guides/testing-redis.md)

## Capsules answer questions; tests preserve accepted behavior

A [Capsule](../../packages/capsule/README.md) is useful for an investigation: establish state, act, inspect retained observations, form a hypothesis, and repeat. An experiment's observations are not automatically normative requirements.

A native Playwright test or generated suite preserves a reviewed expectation in a repeatable form. Every physical test attempt starts a fresh Sandbox; it cannot borrow evidence from a prior Capsule or retry.

## Fit into SDD without owning it

Spec Kit and other SDD tools may own specification authoring, planning, and task organization. A proposed [Spec Kit integration](../integrations/spec-kit.md) bridges the accepted source to Blackbox's verification work. Plain Markdown and native Playwright remain completely valid without an SDD installation.

**Specifications define intent. Executions produce evidence. Verification connects them.**
