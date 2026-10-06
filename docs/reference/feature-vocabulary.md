# Feature step vocabulary

This is the shared v1 vocabulary audited in Gherkin core #131. It is a closed library, not a registry of user-authored step definitions. Ask the installed `blackbox feature steps` command for the version you are running.

`{string}` means a quoted string, `{word}` an HTTP-method word, and `{int}` an integer in the Cucumber expression. `(s)` accepts the singular or plural. These placeholders describe the grammar; replace them with concrete values in a Feature.

## Setup

```text
the client has sent {word} {string} with JSON and received {int}:
```

Use a JSON doc string. Setup acts through the application and checks the stated response. It is not automatic database seeding. The selected project must provide any fixture or administrative endpoint the scenario calls.

## Stimuli

| Sentence | Argument |
| --- | --- |
| `the client sends GET {string}` | None |
| `the client sends {word} {string} with JSON:` | JSON doc string |
| `the client sends these requests concurrently:` | Data table |

The JSON form validates its method and path. It is not permission to use an arbitrary URL or redirect. Use the installed step's example for the concurrent table's exact column contract.

```gherkin
When the client sends POST "/subscriptions" with JSON:
  """json
  {"userId":"alice","paymentMethodId":"pm_alice_primary"}
  """
```

The colon and argument are part of this step. `the client sends POST "/subscriptions"` without them is not in the audited vocabulary.

## Completion barriers

```text
the flow is sealed by the terminal response(s)
the flow is sealed within {int} second(s) when the state at {string} as {string} has {string} equal to:
the flow is sealed within {int} second(s) when the state at {string} as {string} has {int} item(s) at {string}
```

The equality form takes a JSON doc string. Polling deadlines are written in the Feature and validated from 1 to 3600 seconds. The named credential must exist in the selected Sandbox profile.

Use a terminal-response seal only when that response really closes the behavior being checked. An asynchronous workflow needs an appropriate terminal predicate. A fixed delay or completed telemetry export does not make the application complete.

## Response claims

| Sentence | Argument |
| --- | --- |
| `the response status is {int}` | None |
| `the response statuses are {string}` | None; for example `"201, 409"` |
| `the response JSON equals:` | JSON doc string |
| `the response has {string} equal to:` | JSON doc string |
| `the response has {int} item(s) at {string}` | None |
| `the response has a value at {string}` | None |

Member paths are JSON Pointers, not JavaScript or JSONPath expressions. A value claim is not a substitute for an equality claim when the requirement fixes the expected value.

## State claims

```text
the state at {string} as {string} equals:
the state at {string} as {string} has {string} equal to:
the state at {string} as {string} has {int} item(s) at {string}
```

The first two forms take JSON doc strings. The first string identifies an inspection endpoint on the Sandbox entrypoint's origin; the second identifies a configured bearer credential. Features name credentials, not their secret values.

```gherkin
Then the state at "/fixture/state" as "fixture-control" has 1 item at "/subscriptions"
And the state at "/fixture/state" as "fixture-control" has "/subscriptions/0/status" equal to:
  """json
  "active"
  """
```

The inspection endpoint belongs to the application fixture. Blackbox does not infer arbitrary database state or create this endpoint automatically.

## Gated, unavailable in v1

| Sentence | Required capability |
| --- | --- |
| `the effects satisfy:` | `effects-claims` |
| `the {string} participant runs SQL:` | `participant-exec` |

These entries allow the compiler to explain the missing capability. They are not executable just because they appear in a list. Neither telemetry installation nor a Capsule SQL driver enables a missing Gherkin capability.

## Tags and errors

Use exactly one `@system:<id>` and `@sandbox:<profile>` on the Feature. Optional `@requirement:REQ-<n>` annotations carry traceability; they do not select tests or change runner policy. Other tags are rejected.

Undefined or ambiguous steps, invalid doc strings/tables, invalid JSON Pointers, unavailable capabilities, and invalid references fail compilation at the Feature position. Do not resolve such a failure by writing an unreviewed custom step implementation.

## Source contract

[Executable vocabulary contract](https://github.com/suites-dev/blackbox/blob/f52ef2adf561e3222bb0c298abc4835e3c9b8c18/packages/gherkin/src/library/vocabulary.test.ts). [Compiler contract](https://github.com/suites-dev/blackbox/blob/f52ef2adf561e3222bb0c298abc4835e3c9b8c18/packages/gherkin/README.md).

---

[Documentation](../README.md)
