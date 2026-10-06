# @suites/blackbox-gherkin

> Private preview package. Not published: it runs from this repository's workspace, where the root
> manifest adds the `blackbox gherkin` commands to the CLI. Consumer distribution comes later.

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
  `compile-manifest.json`: per scenario its ID, `.feature` location, selection, requirement IDs and barrier
  deadlines, plus the step library identity and the hashes of each feature and generated file.

## Step library v1

`src/library/` is the one shared vocabulary. It covers setup through the application, JSON stimuli
(single and concurrent), completion barriers (a synchronous seal, and polling an inspection endpoint
within a deadline written in the feature), response claims, and state claims that read an inspection
endpoint with a named credential and address members by JSON Pointer. Effects claims and participant
commands are not part of v1. Every step definition is frozen where it is declared, body included, so code
loaded into a run cannot replace a step, and the library hash covers the step bodies.

A named credential such as `"fixture-control"` is defined by the feature's Sandbox profile in
`blackbox.gherkin.json` as a bearer token read from a runner environment variable; features name
credentials, never values, and a credential the profile does not define is a compile error. Requests go
only to the Sandbox entrypoint's origin and do not follow redirects. Library code may not catch,
use `expect.soft`, or set timeouts, retries or timers (enforced by the repository ESLint configuration).

The package root export is the runtime for generated files only. Only `src/library/` may build a step
vocabulary (dependency-cruiser rule `gherkin-registry-is-library-only`).

## Project file and commands

`blackbox.gherkin.json` is the project's protected spec file. Its paths are relative to its directory,
and it refuses any key it does not document:

```json
{
  "schemaVersion": 1,
  "blackboxConfigFile": "blackbox.config.yaml",
  "features": ["features/**/*.feature"],
  "drafts": ["features/drafts/**"],
  "outputDir": ".features-gen",
  "sandboxes": {
    "default": {
      "environment": { "FIXTURE_CONTROL_TOKEN": { "fromEnv": "BLACKBOX_E2E_FIXTURE_TOKEN" } },
      "credentials": { "fixture-control": { "scheme": "bearer", "fromEnv": "BLACKBOX_E2E_FIXTURE_TOKEN" } }
    }
  },
  "changes": { "spec": [], "neutral": ["**/*.md"] }
}
```

Drafts are never compiled, even when a feature glob matches them. The generated tests are native
Playwright tests: run them with `playwright test` from a config whose `testDir` is `outputDir`, built with
`defineConfig` from `@suites/blackbox-playwright/config`. Playwright's own verdicts decide the run.

| Command | What it does |
| --- | --- |
| `blackbox gherkin compile` | Compiles the accepted features into generated tests and `compile-manifest.json`. Prints each scenario with its requirement IDs and barrier deadlines. |
| `blackbox gherkin check` | Fails on project step files, imports of Cucumber, playwright-bdd or the generated-code runtime, patches or forks of the step library or its runtime, and tracked generated tests. |
| `blackbox gherkin check-change --base <ref>` | Fails when one change touches spec paths (features, drafts, this file, the step-library dependency and its patches) and code paths. |
| `blackbox gherkin steps` | Lists the step library with an example sentence per step. |

Every command takes `--config <path>` (default `blackbox.gherkin.json`) and exits 1 when its check fails,
2 when the project file is missing or invalid.

