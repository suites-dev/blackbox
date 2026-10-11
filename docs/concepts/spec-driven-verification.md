# Spec-Driven Verification

**The specification describes intended behavior. Executions produce evidence. Verification compares
them through reviewed expectations.**

As agents write and rewrite implementations, keep that expectation independent from the code's
current structure. The source can be Markdown, an API contract, or an SDD artifact. Blackbox does
not have to own that document to check the running system.

## Why the testing boundary matters

The application runs its implementation. The test enters through I/O, such as an HTTP request,
instead of importing a business class and invoking a method. It inspects outputs, state, and
required interactions of the real participants inside the selected boundary.

You may call such checks integration tests; the important distinction is **where the test enters
and what it depends on**, not the label. Some integration tests also use external interfaces and
real dependencies. Blackbox supplies the agent-operated setup, isolation, investigation and reports.

A service can change its classes or ORM without changing the expected behavior at those interfaces.
Client bindings, fixtures, and observers can still need maintenance. Replacing them must not silently
redefine correctness. Record external dependencies and substitutions; do not remove the behavior or
observer needed to answer the question.

## One specification, three things to keep connected

> Creating a product persists it in PostgreSQL and populates Redis. A valid cache hit must not read
> PostgreSQL.

![The specification, optional Feature and executable suite keep the same cache rule visible.](../assets/readme/specification-triangle.svg)

The Feature is a **durable, reviewable expression of selected expectations**. It is not the entire
spec, and Gherkin syntax alone cannot prevent staleness. The test exercises those expectations; the
run supplies actual results. A passing result is not proof that every source requirement was covered.

## The contract lives beside the test

The intended [behavioral contract](../contracts/README.md) combines reviewed scenarios, TypeScript
output/state assertions, and an accepted effects snapshot when snapshot support is available.

```text
create-payment.feature
create-payment.blackbox.test.ts
create-payment.effects.yaml       # planned accepted baseline, not raw telemetry
```

The layout is illustrative, not a discovery API. A separate `.state.yaml` is undecided. State
assertions remain in the suite. Capturing observations never makes them accepted expectations by
itself; [baseline review](../contracts/reviewing-changes.md) preserves that boundary.

## Write checks in two ways

A Feature compiler emits deterministic native Playwright for supported sentences. Keep generated
code unedited. Native authoring uses project-owned TypeScript and can express richer SDK operations.
The proposed editable-scaffold generator is separate; it does not give authored tests byte-level
equivalence with a Feature.

Both paths use the same underlying system-testing model and can participate in the planned effects
comparison. Gherkin is optional, including for existing Playwright system tests.

[Authoring paths](../features/README.md) · [Editable scaffolds](../playwright/editable-scaffolds.md).

## Three different ways things drift

| Relationship | Check |
| --- | --- |
| Source spec → executable expectations | Review meaning, conditions and omitted cases. |
| Feature → generated suite | Deterministic generation comparison. |
| Accepted runtime expectations → new execution | Execute assertions and, when supported, compare effects. |

An effects difference needs actual runtime observations. It is not Feature-to-TypeScript drift, and
neither check proves that the source specification was adequate.

## The important human boundary

**Is the specification right?** Clarification and review must establish what the team intends.
**Does the implementation meet it?** Blackbox supplies system execution and observations for the
selected checks. Finite system tests do not provide formal proof of all inputs and interleavings.

A Capsule can investigate an unknown before the final test. Fresh Playwright attempts confirm their
own assertions; they do not borrow evidence from the experiment. If a candidate effects baseline
exposes a previously unstated constraint, accepting it is a deliberate decision.

[Why verification matters now](why-verification-now.md) ·
[Developer workflow](../guides/from-spec-to-verification.md) ·
[Spec Kit](../integrations/spec-kit.md)
