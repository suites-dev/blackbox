# Completion barriers

A completion barrier tells the test when it is appropriate to check a particular outcome. It is not a universal statement that all work in the system has stopped.

## Synchronous work

If the application's contract says the operation is committed before its response, the response can be an appropriate completion boundary for that state check. The test must still assert the state it cares about.

The incoming Feature library includes:

```gherkin
And the flow is sealed by the terminal response
```

That step records the authored completion assumption. It does not prove that background jobs finished merely because an HTTP request returned.

## Asynchronous work

For a job or consumer, use a terminal application predicate and a bounded deadline. For example, in a fixture exposing its completed order state:

```gherkin
And the flow is sealed within 5 seconds when the state at "/fixture/state" as "fixture-control" has 1 item at "/completedOrders"
```

The endpoint and pointer in this example are project-specific. The supported polling expression is from the shared vocabulary. Deadlines must be 1–3600 seconds in the audited compiler; choose a deadline justified by the accepted scenario rather than repeatedly increasing it until the test passes.

## Completion and observation are separate

Business completion may happen before trace export is retained. Conversely, the collector can be idle while the application still has delayed work. `capsule run --wait` concerns telemetry waiting after the child exits; it does not replace an application completion check.

For an absence claim, the chosen terminal predicate must also exclude later relevant work within the claimed interval. Merely observing the first successful event cannot rule out a later duplicate.

## Failure handling

A deadline failure is evidence about the attempted check. Do not repeat a non-idempotent stimulus in the polling loop. Preserve the initial action and retry only the read. Do not convert a timeout or missing state into an empty successful result.

Next: [Feature vocabulary](../reference/feature-vocabulary.md) · [Async test authoring](../playwright/writing-tests.md).

## Source contract

[Audited step expressions](https://github.com/suites-dev/blackbox/blob/f52ef2adf561e3222bb0c298abc4835e3c9b8c18/packages/gherkin/src/library/vocabulary.test.ts).

---

[Documentation](../README.md)
