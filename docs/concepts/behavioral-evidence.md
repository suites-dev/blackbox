# What counts as evidence?

Suppose the specification says **a product must be saved**. Would HTTP `201` convince you? Or would you also check the database?

Call the requirement a *claim* if you like: something the spec says must be true. **Evidence** means what we actually observed that helps check it.

## The same response, different behavior

<p align="center">
  <img width="790" src="../assets/guides/product-cache-evidence.svg" alt="Both versions return the expected product, but the broken cache path also queries PostgreSQL and violates the requirement." />
</p>

The product example checks three useful kinds of evidence:

| What we check                    | Example                                | What it answers              |
| -------------------------------- | -------------------------------------- | ---------------------------- |
| **Outcome**                      | HTTP status and body                   | What did the caller receive? |
| **State**                        | PostgreSQL row or Redis value          | What was stored?             |
| **Runtime activity** (*effects*) | SQL query, Redis GET, outgoing request | What did the application do? |

These are **options, not a required checklist**. A response assertion may fully answer one spec; another spec may require all three.

An observed `INSERT` doesn't mean the transaction committed. Finding a value in Redis doesn't mean the application's retrieval used that value. Choose an observation that answers the exact question.

## HTTP isn't the only entrypoint

| Entry point    | Immediate result                                         | Another thing a spec might require      |
| -------------- | -------------------------------------------------------- | --------------------------------------- |
| HTTP           | Status, headers, body                                    | Persisted state, downstream activity    |
| Queue consumer | Handler outcome or broker-specific acknowledgment/offset | Business completion, duplicate handling |
| CLI            | Exit code, stdout, stderr                                | Files, database rows, network effects   |
| Scheduled job  | Scheduler/job status, when exposed                       | Actual completion of delegated work     |

There is **no universal queue response** like HTTP. Receiving, processing, acknowledging, and completing downstream work can happen at different points.

These rows explain how to **design an observation**; the current product walkthrough uses HTTP and is not evidence that Blackbox ships ready-made adapters for every row.

## Why absence is harder than presence

How can we check something that *didn't* happen?

A cached retrieval **must not read PostgreSQL**. Finding no SQL span in OpenTelemetry isn't enough: the right process might not be instrumented, or traces might be missing.

The [product-cache walkthrough](../guides/testing-redis.md#observe-the-retrieval-within-a-bounded-window) uses a stronger method:

1. Make a **known cache miss** and check that the observer can detect its SQL query.
2. Establish a cached product and start a measurement window.
3. Retrieve it once and compare the observed Redis and application PostgreSQL operations.

```text
Valid cache hit:          Redis GET 1  | PostgreSQL statements 0
Deliberate cache bypass:  Redis GET 1  | PostgreSQL statements 1
```

These are expected example measurements, **not live results pasted from a report**. The absence check depends on the sample's isolated window, application database role, and correct counter calibration.

## Wait for the right completion

A response may arrive before background work finishes. A queue acknowledgment doesn't necessarily mean an invoice was created. When the spec permits eventual completion, the test should wait for the **specific outcome** it requires.

<p align="center">
  <img width="790" src="../assets/guides/async-completion.svg" alt="Conceptual queue example: submit a job, let the worker process it, and poll the matching stored result rather than treating submission as completion." />
</p>

The [async test guide](../guides/testing-async-flows.md) shows how to wait for an expected state with Playwright. The picture is conceptual, not a demonstration of a shipped queue driver.

## Know what the run did and didn't establish

Check that the scenario started in a known state, executed the intended action, reached the required completion point, and collected observations that actually cover the behavior.

One claim can be supported while another remains **unresolved** because no suitable observer ran, or an earlier test step failed. That isn't automatically evidence that the behavior didn't occur.

Current Blackbox tests use Playwright's real assertion results and retained diagnostics. *Supported, refuted, and unresolved* are helpful ways to describe evidence—not a guarantee that the alpha produces a universal three-valued verdict.

## Where telemetry fits

OpenTelemetry can show supported network and database activity in instrumented processes. It's a valuable **source of runtime observations**, not the center of the product or proof of every business outcome. A payment-request span, for example, isn't proof that money settled.

[PostgreSQL](../guides/testing-postgres.md) · [Redis and absence](../guides/testing-redis.md) · [Evidence-led repair](../guides/repair-from-evidence.md)
