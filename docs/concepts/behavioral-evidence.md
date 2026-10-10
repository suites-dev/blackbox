# Behavioral evidence

A test oracle decides whether observed behavior agrees with an expected result. For Blackbox, the **accepted behavioral claim** determines which observations are needed and whether they are sufficient.

Blackbox is not defined by OpenTelemetry. Runtime telemetry is one evidence source alongside entrypoint outcomes and explicit state inspection. A trace, a response, or a process exit may be useful without being conclusive for the claim at hand.

## Work backward from the claim

Before creating a test, identify:

1. **Starting conditions:** selected SUT, initial data, resources, relevant replacements, and dependencies.
2. **Stimulus:** which entrypoint receives the action, message, or trigger?
3. **Expected outcome:** what exactly must hold or must not happen?
4. **Observation:** which response, state reader, effect observer, or business completion signal can establish it?
5. **Completion boundary:** when is the requirement due to hold, and what is its accepted deadline?
6. **Limits:** which activity, processes, or external dependencies are not observed or controlled?

Select evidence because it answers the claim—not because instrumentation happened to record it.

## Different entrypoints have different outcomes

| Entry point | Immediate outcome, when exposed | What this does not prove on its own |
| --- | --- | --- |
| HTTP | Status, headers, response body | Committed state, completed downstream work, or absence of a forbidden call |
| Queue consumer | Handler result and broker-specific acknowledgment, negative acknowledgment, or offset commit | Business completion, exactly-once side effects, or downstream processing |
| CLI | Exit status, stdout, stderr | Filesystem, database, or external changes unless separately checked |
| Scheduled job | Invocation or job completion status if exposed | Delegated work finishing or correct persistent state |
| Stream/event consumer | Offset/checkpoint or emitted record where available | Correct projections or absence of duplicated handling |

There is **no universal queue response** analogous to HTTP. Receipt by a broker, delivery to a consumer, processing by the application, and settlement/acknowledgment are distinct points. A business specification may demand evidence later than any one of these.

**Availability:** the current documented product sample exercises HTTP. Other entrypoints are evidence-design examples, not promises of shipping Blackbox adapters or ready-made steps.

## Outcomes

An entrypoint's reported result establishes what was returned by *that boundary*. If an HTTP request returns `201`, the server responded successfully. It does not show that a row was committed. If a CLI exits `0`, the process declared success; a downstream effect still needs independent observation when the spec requires it.

## State

State evidence inspects the effects of a completed operation: committed PostgreSQL rows, Redis values, files, or another domain store.

For the product example, `GET /fixture/products/product-1` exposes **independently read** PostgreSQL and Redis state. That endpoint is implemented by the *example application*, not Blackbox. It is different from asserting that the creation response echoed the request body.

An observed SQL `INSERT` may roll back; a committed-state claim needs a suitable state read, under the database's visibility model. A test-side Redis `GET` proves the cache held a value at that point; it doesn't prove the application served the value from cache.

[PostgreSQL state](../guides/testing-postgres.md) · [Redis state](../guides/testing-redis.md)

## Runtime effects

Runtime effects are supported observations of operations performed during an execution: network calls, SQL operations, cache access, message publication, processing, and background activity.

OpenTelemetry spans can make these operations inspectable and correlate portions of an execution. But a client span recording an attempted request is not the recipient's settlement, and a span for a database statement is not a durable transaction result.

Instrument the *process performing the operation*. A test runner's instrumentation does not observe operations performed inside an uninstrumented subprocess or another service by magic.

The current alpha's effects handle does not constitute a universal completed effect projector or deterministic evaluator for arbitrary claims. Use the supported observations and explicit assertions that actually exist; do not fabricate effect verdicts.

## Why absence is harder than presence

The product spec says a valid-cache retrieval **must not read PostgreSQL**. A missing trace span alone can't establish that negative claim. The relevant operation might be uninstrumented, dropped, outside the observation window, or performed by another process.

The sample uses a more bounded method:

- It **calibrates** the observer with a known cache miss that must exercise the application's PostgreSQL path.
- It establishes the relevant product's persisted and cached state.
- It starts a measured window for **one** application retrieval, separate from test-side inspection.
- It checks Redis command counts and application-role PostgreSQL statement counters within that window.

The positive control demonstrates that the observer can detect a known database read. The zero-read result is therefore stronger than an absent span—**provided the window, application role, and workload isolation match the claim**.

[Examine the cache-only assertion](../guides/testing-redis.md#observe-the-retrieval-within-a-bounded-window)

## Completion and causality

An HTTP response may precede a worker. A queue acknowledgment may not imply a projection has become visible. If the accepted requirement allows eventual completion, use an explicit completion condition and deadline. Do not add polling to make a requirement that promises immediate completion pass.

Observations in the same Sandbox are not necessarily *caused by* the selected action. Use resource identity, execution context, correlation where available, and bounded observation windows. Background traffic, shared external dependencies, or test-side reads can contaminate counts and invalidate absence claims.

[Asynchronous verification](../guides/testing-async-flows.md)

## Supported, refuted, or unresolved

For evidence reasoning:

- **Supported:** the required checks executed and sufficient observations support the claim under the declared conditions.
- **Refuted:** an executed check found a contradictory result.
- **Unresolved:** the attempt did not reach the claim, an observer was unavailable, or the completion/causality requirements were not established.

These are **reasoning categories**, not advertised machine-readable verdicts shipped by the current alpha for all protocols. Playwright still determines actual test pass/fail/skip outcomes, and Blackbox retains diagnostics from the attempted execution.

A green test tells you *which assertions passed*. An agent's explanation should identify each claim, its evidence and limits, and the attempts that did not establish a result.

## Repair without moving the goalposts

If an accepted rule fails, give the agent the failed step, observed state/effect values, execution identity, and limits. Investigate the implementation or observation method before proposing any change to the spec.

The [cache-bypass repair chapter](../guides/repair-from-evidence.md) keeps the accepted expectation fixed while an agent fixes a database access that ordinary HTTP assertions miss.

[Spec-Driven Verification](spec-driven-verification.md) · [Full verification walkthrough](../guides/verify-a-specification.md)
