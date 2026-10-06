# Execution and retries

A logical test can have several physical attempts because of retries, repeats, or project selection. Evidence belongs to a physical attempt.

```text
Test A / attempt 0 -> Sandbox A0 -> failed check + retained evidence
Test A / attempt 1 -> Sandbox A1 -> passed check + different evidence
```

## Fresh means fresh

Every attempt receives a new Sandbox and execution identity. The configuration name `default` does not mean a shared live container. Setup must run again and evidence must not be borrowed from the previous attempt.

A retry preserves the earlier failure. Do not merge its observations or state reads with the later attempt to claim an exact count, successful cleanup, or complete behavior.

## Lifecycle outcomes

Setup failure, assertion failure, timeout, skip, and interruption are separate events. The fixture requests cleanup after the test and attempts cleanup when acquisition fails. Cleanup failure remains a failure to release the intended resources even when the application assertion passed.

A report should make the test project, scenario, repeat/retry coordinates when present, execution identity, and cleanup outcome inspectable.

## Strict verification

Incoming reporter guardrails offer `verdicts: 'strict'`. Under that contract, a retry pass, skipped test, expected failure, or interrupted execution is not a clean supported verification result.

Native Playwright behavior remains distinct from these opt-in rules. Do not assume the baseline reporter has strict semantics before the corresponding version is installed. See [availability](../status.md).

## Parallelism

Isolation enables concurrent attempts, but each environment consumes memory, CPU, containers, and dependency capacity. Start with measured per-Sandbox resource use and choose workers within the host budget. A rough planning bound is available memory divided by peak per-Sandbox memory, with headroom for the OS, runner, builds, and bursts; it is not a guarantee against exhaustion.

Shared external dependencies can still create contention or cross-test interference. Reducing workers can relieve pressure but does not fix incorrect ownership or cleanup.

Next: [CI](ci.md) · [Reports](reports.md).

## Source contract

[Implementation](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/playwright/README.md). [Strict reporter contract](https://github.com/suites-dev/blackbox/pull/155).

---

[Documentation](../README.md)
