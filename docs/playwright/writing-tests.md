# Writing system tests

Start with an accepted behavior, not the implementation's current output. State the initial conditions, perform a deliberate action, and check the outcomes with evidence that can answer the requirement.

## Keep the behavior visible

Use native `test.step` labels for meaningful setup, actions, and assertions. Put project plumbing in named helpers, but do not hide the expectation, a retry policy, or an unbounded wait inside them.

```ts
const response = await test.step('When Alice subscribes', () =>
  request.post(new URL('/subscriptions', sandbox.entrypoint.url).href, {
    data: { userId: 'alice', paymentMethodId: 'pm_alice_primary' },
  }),
);
expect(response.status()).toBe(201);
```

This checks only the response. Add a state read to verify persistence. The [complete example](../examples/README.md) shows both; do not present the fragment above as proving subscription creation on its own.

## Establish state per attempt

Use fixture data or explicit setup in a per-test hook. A fresh environment helps isolate attempts, but the application's initial data still needs to be known. Repeated runs must not depend on another test having created a user or emptied a queue.

Use unique business identifiers when shared infrastructure remains outside the Sandbox. Do not claim full isolation for an external account, bucket, payment provider, or queue shared with other work.

## Asynchronous outcomes

Poll an explicit terminal predicate with a bounded deadline. Poll the read, not the non-idempotent action. A response returning `202 Accepted` does not establish completion, and a collector wait does not establish business quiescence.

For an absence or exact-count assertion, choose a completion boundary that covers possible late work. See [completion barriers](../verification/completion-barriers.md).

## Runtime assertions

Use response and state assertions normally. Inspect raw telemetry when useful. Only use effects matchers when the installed version supplies a supported evaluator; do not turn an empty observation list into proof of no side effects.

## Challenge the test

Ask whether the test would fail if the row were not saved, the wrong customer were updated, or the downstream request happened twice. Prefer a focused negative control when practical. A test title and a requirement annotation do not establish the strength of the assertion.

## Focused development

```sh
npx playwright test tests/system/subscriptions.spec.ts
npx playwright test --grep 'Alice subscribes'
```

These are partial runs. Keep them separate from the broader required CI scope and any policy baseline that fixes that scope.

## Source contract

[Implementation](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/playwright/README.md).

---

[Documentation](../README.md)
