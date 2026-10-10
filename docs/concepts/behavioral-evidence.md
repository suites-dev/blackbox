# How do you know the test checked the right thing?

An agent can write an implementation, send an HTTP request, and see `200`. But **is that the result the specification required?** And what might be missing behind the response?

This is the *test oracle problem*: generating test inputs is different from deciding whether the observed behavior was correct. Historically, a human could inspect the system and judge. As coding agents do more implementation work, we need more of that judgment expressed in **reviewed checks and trustworthy observations**.

Blackbox helps build those checks. It does **not** automatically invent a correct oracle from arbitrary prose. [Research background: *The Oracle Problem in Software Testing: A Survey*](https://ieeexplore.ieee.org/document/6963470).

## The same response, different behavior

Our example specification says creating a product stores it in PostgreSQL and Redis, and a valid cache hit **must not read PostgreSQL**.

<p align="center">
  <img width="790" src="../assets/guides/product-cache-evidence.svg" alt="Both implementations return the same product; one violates the accepted behavior by reading PostgreSQL despite a valid cache entry." />
</p>

The product can be correct in the response **and** wrong in how it was retrieved. The test needs the observations required by the rule:

| What we check | Example | What it answers |
| --- | --- | --- |
| **Outcome** | HTTP status and JSON body | What did the caller receive? |
| **State** | PostgreSQL row or Redis value | What was actually stored? |
| **Runtime activity** (*effects*) | SQL query, Redis GET, outgoing request | What did the running system do? |

These are **choices, not a mandatory checklist**. The specification decides which matter.

An observed `INSERT` doesn't establish that a transaction committed. Finding a product in Redis doesn't establish that the application served it from Redis. Choose the observer that answers the *specific* question.

## The outcome depends on how the system is entered

| Entry point | Immediate result | What may need another check |
| --- | --- | --- |
| HTTP | Status, headers, response | Persisted state, downstream calls |
| Queue consumer | Handler result, acknowledgment or offset commit, depending on broker | Business completion, duplicate handling |
| CLI | Exit status, stdout, stderr | Files, database changes, external effects |
| Scheduled job | Scheduler/job result, when available | Work completed by another process |

A queue consumer has **no universal HTTP-like response**. Receipt, processing, acknowledgment, and downstream completion can be separate events.

These are principles for designing a test, **not promises** that the current alpha provides built-in drivers for every entrypoint.

## Why absence is harder than presence

To assert that cached retrieval never read PostgreSQL, a missing OpenTelemetry SQL span isn't enough. That process may not be instrumented; the observer may have missed the call.

The [product-cache test](../guides/testing-redis.md#observe-the-retrieval-within-a-bounded-window) instead:

1. **Calibrates** its observer with a known database read.
2. Establishes stored and cached product state.
3. Measures exactly one cache-hit retrieval in a bounded, isolated window.

```text
Expected valid cache hit:  Redis GET 1  | PostgreSQL statements 0
Deliberate cache bypass:   Redis GET 1  | PostgreSQL statements 1
```

These are *expected example measurements*, not a screenshot of a completed run. The assertion depends on correct calibration, application-role filtering, and a window without unrelated traffic.

## Wait until the behavior is actually complete

A response may precede asynchronous work. A queue acknowledgment doesn't necessarily mean an invoice was created. A specification that allows eventual completion needs a **specific result and a deadline**.

<p align="center">
  <img width="790" src="../assets/guides/async-completion.svg" alt="Conceptual queued work is verified by checking that the matching record reaches completed status rather than trusting submission alone." />
</p>

The [async guide](../guides/testing-async-flows.md) uses Playwright polling for a documented state condition. The diagram is conceptual, not a shipped queue driver.

## Read the result without overstating it

A result can support one expectation but leave another unanswered because observation was unavailable or the test failed before reaching it. The same Sandbox also doesn't guarantee two observed operations caused one another; request identity, timing, and completion matter.

**Supported, refuted, and unresolved** are useful terms for what the collected information establishes. They are **not** a universal three-valued result API shipped by this alpha. Blackbox's current native path uses Playwright assertions and retained diagnostics.

OpenTelemetry contributes runtime observations where instrumentation exists. It isn't Blackbox's definition, and an attempted payment span is not proof of a settled payment. System tests provide evidence for **specific executions**, not formal guarantees for every possible behavior.

[Why verification matters now](why-verification-now.md) · [PostgreSQL](../guides/testing-postgres.md) · [Redis](../guides/testing-redis.md) · [Repair the cache bug](../guides/repair-from-evidence.md)
