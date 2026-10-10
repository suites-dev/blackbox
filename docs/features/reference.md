# Feature language and compiler reference

Use this page to look up syntax after [running your first Feature](drafting-feature-files.md).
Blackbox parses Gherkin with Cucumber and compiles the supported HTTP sentences
into native Playwright declarations. This page describes the current alpha compiler.

## What the compiler can and cannot establish

A successfully compiled Feature shows that its supported sentences
mapped to native Playwright declarations. It doesn't prove that
every part of the accepted specification was represented or that
the running application satisfies the resulting checks.

Features help an SDD workflow preserve reviewed scenarios. Native
Playwright remains first-class when a claim requires an SDK operation
beyond this compiler's HTTP vocabulary.

[Spec-Driven Verification](../concepts/spec-driven-verification.md) ·
[Evidence limits](../concepts/behavioral-evidence.md).

## Select the system and Sandbox

Now connect the scenario to the system it should exercise. Put selectors on the
Feature so the generated suite can use the intended catalog entry:

| Tag                      | Meaning                                                       |
| ------------------------ | ------------------------------------------------------------- |
| `@system:product-system` | Select the catalog system with this ID.                       |
| `@subsystem:orders`      | Select a subsystem instead of a system.                       |
| `@sandbox:default`       | Name the generated `system.sandbox(...)` configuration group. |

Use one system or subsystem selector. Without one, the compiler uses the Feature
name as a subsystem ID. Without a Sandbox tag, it uses `default`. Explicit tags
make the catalog relationship easier to review.

Other tags, such as `@smoke`, become Playwright tags. Feature, Rule, Scenario,
and Examples tags remain on their corresponding generated declarations.
Selector tags on the Feature configure the suite rather than becoming test tags.

## Group behavior and shared setup

As you add scenarios, some will express the same business rule or need the same
starting state. Group related scenarios with a `Rule` and put shared setup in a
`Background`, so readers can see what each scenario depends on.

A Rule becomes a nested Playwright `describe`. A Feature Background becomes a
`beforeEach` hook; a Rule Background adds setup for that Rule's scenarios.
Keep each scenario's actions and assertions in their authored order.

Use a Background only for setup shared by every scenario in its scope. The
product example gives each test a fresh Sandbox and keeps creation setup explicit
in the cached-retrieval scenario. There is no need for an additional reset request.

```gherkin
Given client "api" has sent POST "/products" with JSON and received 201:
  """json
  { "id": "product-1", "name": "Field notebook", "priceCents": 1299 }
  """
```

This is an action used as a precondition for a later retrieval. The
[complete product Feature](../../e2e/product-cache/tests/product-cache.feature)
checks the stored PostgreSQL and Redis values before exercising that retrieval.

Doc Strings must contain valid JSON. In a fields table, each `json` cell is a JSON
value, so strings include double quotes. Field names are object keys. Use nested
JSON objects to match nested response data.

## Repeat a Scenario with Examples

When the same behavior should hold for several inputs, a Scenario Outline lets
you describe it once and list those inputs as Examples. Each row generates its
own Playwright test. This fragment creates two distinct products in separate attempts:

```gherkin
@system:product-system @sandbox:default
Feature: Product response examples
  Scenario Outline: Create product <id>
    When client "api" sends POST "/products" with JSON:
      """json
      { "id": "<id>", "name": "<name>", "priceCents": <priceCents> }
      """
    Then the response status is 201

    Examples: Products
      | id        | name           | priceCents |
      | notebook  | Field notebook | 1299       |
      | pencil    | Graphite pencil | 299       |
```

This fragment checks creation status only. The complete product rule also needs
state and cache-hit assertions, as shown in the walkthrough.

Use matching Examples column names for placeholders. In JSON, `"<name>"`
produces a string; an unquoted `<quantity>` can preserve a numeric Examples value.
Test titles include the Examples block and row number, so identical row values
still produce distinct tests.

For a complete first execution, use the [Feature tutorial](drafting-feature-files.md).

## Sentence reference

Run `pnpm exec blackbox feature step list` to inspect the available vocabulary.
`METHOD` below is `GET`, `POST`, `PUT`, `PATCH`, or `DELETE`.

| Sentence after the Gherkin keyword                                 | Result                                                          |
| ------------------------------------------------------------------ | --------------------------------------------------------------- |
| `client "api" sends METHOD "/path"`                                | Send a request and retain its response for assertions.          |
| `client "api" sends METHOD "/path" with JSON:`                     | Send the JSON Doc String as request data.                       |
| `client "api" has sent METHOD "/path" with JSON and received 201:` | Send a setup request and assert its status in the same step.    |
| `the response status is 200`                                       | Assert the preceding request's status.                          |
| `the response JSON contains:`                                      | Match the JSON Doc String as a partial response object.         |
| `the response JSON contains these fields:`                         | Match fields from a Data Table with `field` and `json` columns. |
| `client "api" GET "/path" returns 200 with JSON exactly:`          | Send a GET and assert both its status and complete JSON body.   |

Sentence text selects the operation. `Given`, `When`, `Then`, `And`, `But`, and
`*` supply the readable step labels. Keep response assertions after the request
in the same Scenario. Use combined request/assertion steps for self-contained
setup or inspection.

The current alpha compiler accepts only this HTTP vocabulary. Other sentences,
including queue operations and effect assertions, produce diagnostics and no
suite. Adding an SDK client does not extend that vocabulary. Blackbox's native
Playwright tests can call other SDKs directly; use the
[bounded polling guide](../guides/testing-async-flows.md) for a native PostgreSQL
observation example.

## Client modules and generated artifacts

`--clients` names a TypeScript module. The CLI scans directly named `export const`,
`export let`, or `export var` declarations; prefer `export const` for client
definitions. Re-export barrels are unsupported. This scan does not typecheck the
value, connect the SDK, or verify a catalog entry exists.

Generated imports are relative to the output file and use JavaScript extensions
for TypeScript source modules. Keep candidate files beside the accepted suite so
their relative imports stay the same. The destination directory must already
exist, and emission refuses to overwrite any file.

Suite validation compares generated bytes, including formatting. Keep generated
files outside automatic formatting. It checks generated artifacts rather than
behavioral equivalence with arbitrary handwritten tests.

## Command availability

`feature step list`, `feature file validate`, `feature suite emit`, and
`feature suite validate` are implemented. `feature file draft` and
`feature run verify` are registered but return unavailable errors. A human or
coding agent can draft scenarios for review; Playwright runs their generated
assertions. Completed-run Feature verification and coverage are not supplied by
these commands.

See the [CLI reference](../../packages/feature/src/cli/README.md) for arguments.
