# Feature files

Blackbox's incoming compiler uses the Cucumber parser, but it does not expose arbitrary project step definitions. The closed step library gives every accepted step a reviewed executable meaning.

## A small scenario

This example assumes the selected fixture starts with no subscriptions and knows Alice:

```gherkin
@system:subscription-system @sandbox:default
@requirement:REQ-101
Feature: Subscription creation
  Scenario: Alice subscribes
    When the client sends POST "/subscriptions" with JSON:
      """json
      {"userId":"alice","paymentMethodId":"pm_alice_primary"}
      """
    Then the response status is 201
    And the state at "/fixture/state" as "fixture-control" has 1 item at "/subscriptions"
```

`/fixture/state` is an application-owned inspection endpoint. `fixture-control` names a credential in the Sandbox profile; its secret value is not written in the Feature. See the [complete example](../examples/README.md).

## Tags

| Tag | Location and role |
| --- | --- |
| `@system:<id>` | Exactly once on Feature; selects a catalog entry and its declared kind |
| `@sandbox:<profile>` | Exactly once on Feature; selects a profile in `blackbox.feature.yaml` |
| `@requirement:REQ-<n>` | Feature, Rule, or Scenario; traceability annotations only |

Other tags are compile errors in the audited preview. Do not use `@smoke`, `@skip`, or a tag to change retries, timeouts, or results.

## Structure

A Feature Background becomes attempt-scoped setup. A Rule becomes a nested group and can supply its own Background. Feature setup runs before Rule setup. Each Scenario Outline example row becomes a separate test; it does not share state with another row.

Each scenario must make a claim. A title or a sequence of actions is not an assertion. Keep the action, any completion barrier, and the claim distinct.

## Boundaries and deadlines

Request paths must stay on the Sandbox entrypoint origin. Redirects are not followed by the shared step library. Polling deadlines are written in the Feature and validated; hiding waits in a helper would make the execution conditions harder to review.

Telemetry/effects claims and participant SQL steps are capability-gated and unavailable in the audited v1 vocabulary. Native Playwright can still express project-specific state checks; that does not make a made-up Gherkin sentence executable.

Next: [Vocabulary](../reference/feature-vocabulary.md) · [Validation](validate.md).

## Source contract

[Compiler contract](https://github.com/suites-dev/blackbox/blob/f52ef2adf561e3222bb0c298abc4835e3c9b8c18/packages/gherkin/README.md).

---

[Documentation](../README.md)
