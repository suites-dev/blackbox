# @suites/blackbox-gherkin

> Alpha package. The API may change before the first stable release.

Reads and validates human-authored Gherkin `.feature` files. It does not generate or run tests, and it never
imports Playwright or the step library: the sentences a feature may use arrive as plain data, and the outline
of each feature leaves as plain data for whatever emits or compares a Playwright suite.

## API

| Export                                    | What it does                                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `loadGherkinProject(path)`                | Reads and checks the project file `blackbox.feature.yaml`. Throws `GherkinConfigError` naming every problem. |
| `validate(project, sentences, catalog)`   | Checks every accepted feature and the project. Resolves to every error, empty when valid. Writes nothing.    |
| `outline(project, sentences)`             | Resolves to the outline of every accepted feature, in path order. Writes nothing.                            |
| `outlineFeature(source, file, sentences)` | The outline of one feature source. Throws `InvalidFeatureError` when it does not parse.                      |
| `formatValidationError(error)`            | Prints an error as `file:line:column: message`.                                                              |

## What `validate` checks

Every error carries a `code`, the `file` relative to the project directory, and a `line` and `column`.

- **Syntax**: features are parsed with the official Cucumber parser (`@cucumber/gherkin`) and declare a Feature
  with at least one scenario. A scenario has steps, a Scenario Outline has Examples rows, and titles are unique.
- **Tags**: only `@system:<id>` and `@sandbox:<profile>` (each exactly once, on the Feature) and
  `@requirement:REQ-<n>` (on a Feature, Rule or Scenario). `@system:` names a catalog entry and `@sandbox:` a
  profile of the project file. Any other tag is an error, so no tag can change runner policy, select scenarios or
  change a verdict.
- **Sentences and values**: every step, in every Examples row, matches exactly one sentence, with values its
  parameter types accept and the doc string or data table the sentence takes.
- **Capabilities**: a sentence that needs a capability the runtime does not offer is an error.
- **Barriers**: a step whose sentence needs a completion barrier has a barrier step before it, in a Background or
  the scenario.
- **Then**: every scenario has at least one Then step of its own (an `And` or `But` after a Then counts).
- **No Gherkin runner**: no project source imports `@cucumber/cucumber`, `playwright-bdd` or a similar runner
  that defines its own steps.
- **No copy of the step library**: no package manifest, override, resolution, patch or `pnpm-workspace.yaml`
  entry points the step library at a fork or patches it, from the project directory up to the repository root. A
  local tarball passes only when it is a pack of the library at the sentence list's version.

## Sentence list

The step library produces this shape; `validate` and `outline` only read it.

```ts
interface SentenceList {
  readonly library: { readonly name: string; readonly version: string };
  readonly capabilities: readonly string[];
  readonly sentences: readonly Sentence[];
}

interface Sentence {
  readonly expression: string; // a Cucumber expression
  readonly parameterTypes: readonly { readonly name: string; readonly pattern: string }[];
  readonly argument: 'none' | 'doc-string' | 'data-table';
  readonly requires: string | null; // a capability
  readonly barrier: boolean;
  readonly needsBarrier: boolean;
  readonly example: string;
}
```

## Outline

Per feature: `file`, `title`, `tags`, the Feature `background`, `scenarios` and `rules` (each with its own
`background` and `scenarios`). A scenario has a `title`, its `tags`, the Examples row it was expanded from (or
null) and its own ordered steps. A step has its `keyword`, `text`, the matched `sentence` expression (or null),
the parameter `values` as text, and its doc string or data table. Every node has its `.feature` `line` and
`column`.

## Project file

`blackbox.feature.yaml` is the project's protected spec file. Its paths are relative to its directory, and it
refuses any key it does not document:

```yaml
schemaVersion: 1
blackboxConfigFile: blackbox.config.yaml
features:
  - features/**/*.feature
sandboxes:
  default:
    environment:
      FIXTURE_CONTROL_TOKEN: { fromEnv: BLACKBOX_E2E_FIXTURE_TOKEN }
    credentials:
      fixture-control: { scheme: bearer, fromEnv: BLACKBOX_E2E_FIXTURE_TOKEN }
```

Sandbox profiles name environment variables, never values.
