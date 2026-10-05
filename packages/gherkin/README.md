# @suites/blackbox-gherkin

> Private preview package. Not published, and not usable from a project yet: the configuration helper
> and the `blackbox gherkin` commands land in later changes.

Compiles human-authored Gherkin `.feature` files into native Playwright tests that declare their boundary
through the public `test.system(...).sandbox(...)` facade of `@suites/blackbox-playwright`.

## What the compiler does

- Parses features with the official Cucumber parser (`@cucumber/gherkin`) and compiles each pickle to one
  `suite.test(...)`. A `Background:` becomes an attempt-scoped `suite.beforeEach`, a `Rule:` a nested
  `suite.describe`, and each `Scenario Outline` row a separate test titled
  `Scenario: <name> [<header>=<value>, …]`.
- Accepts exactly three tag namespaces. Any other tag is a compile error that names the tag and its
  `file:line:column`, so no tag can change runner policy, select scenarios or change a verdict.

  | Tag | Where | Rule |
  | --- | --- | --- |
  | `@system:<id>` | Feature, exactly once | A catalog entry from `blackbox.config.yaml`; its kind is read from the catalog. |
  | `@sandbox:<profile>` | Feature, exactly once | A Sandbox profile from project configuration. It names environment variables, never values. |
  | `@requirement:REQ-<n>` | Optional on Feature, Rule or Scenario | Traceability only. Emitted as `requirement` annotations; a scenario carries the union of its levels. |

- Resolves every step against one closed, shared step library. An undefined or ambiguous step, a step whose
  doc string or data table does not match, and a step that needs a capability this runtime does not offer
  (effects claims, participant exec) are compile errors. A scenario must make a claim, and an effects claim
  needs a completion barrier before it.
- Runs each step as a native step whose location is the `.feature` line; a failing step is reported there
  too, not at the generated file.
- Writes all generated tests or none into a git-ignored output directory, together with
  `compile-manifest.json`: per scenario its ID, `.feature` location, selection and requirement IDs, plus the
  step library identity and the hashes of each feature and generated file.

## Step library v1

`src/library/` is the one shared vocabulary. It covers setup through the application, JSON stimuli
(single and concurrent), completion barriers (a synchronous seal, and polling an inspection endpoint
within a deadline written in the feature), response claims, and state claims that read an inspection
endpoint with a named credential and address members by JSON Pointer. Effects claims and participant
commands are not part of v1.

A named credential such as `"fixture-control"` is a bearer token read from the runner environment
variable `BLACKBOX_CREDENTIAL_FIXTURE_CONTROL`; features name credentials, never values. Requests go
only to the Sandbox entrypoint's origin and do not follow redirects. Library code may not catch,
use `expect.soft`, or set timeouts, retries or timers (enforced by the repository ESLint configuration).

The package root export is the runtime for generated files only. Only `src/library/` may build a step
vocabulary (dependency-cruiser rule `gherkin-registry-is-library-only`).
