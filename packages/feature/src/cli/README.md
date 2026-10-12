# Feature CLI

This CLI turns an optional Gherkin Feature into a native Blackbox Playwright
suite. It separates three questions: **does the Feature compile**, **does the
generated suite still match it**, and **what happened when Playwright ran it**.
Compilation and suite comparison are implemented; run verification is reserved
but unavailable until its results contract is defined.

## Proposed workflow

```sh
blackbox feature file draft <specification.md> [--output <candidate.feature>]
blackbox feature step list
blackbox feature file validate <feature> --clients <module> [--config <blackbox.config.yaml>]
blackbox feature suite emit <feature> --clients <module> --output <spec.ts> [--config <blackbox.config.yaml>]
blackbox feature suite validate <feature> --clients <module> --output <spec.ts> [--config <blackbox.config.yaml>]
npx playwright test <spec.ts>
blackbox feature run verify <feature> --results <results.json>
```

`<feature>` is the primary input and is positional. `--clients` identifies a
project-owned TypeScript registration module; `--output` identifies the generated
suite. The client module supplies names and `defineClient(...)` definitions. It
is a development-time input, not a JSON driver registry. The CLI currently recognizes directly named `export const` declarations and
reports other export forms as missing bindings. The catalog remains the authority
for Sandbox acquisition and instrumentation.

Every Feature names exactly one catalog entry with a `@system:<id>` or
`@subsystem:<id>` tag. The compiling commands load the nearest
`blackbox.config.yaml` above the Feature, or the file given with `--config`, and
reject a missing tag, an id the catalog does not have, or a tag whose kind differs
from the entry's `kind`. Each diagnostic points at the tag, or at the `Feature:`
line when the tag is missing, and a missing catalog is an error. `@sandbox:<name>`
names the Playwright sandbox declaration and is not checked against the catalog.

In the vocabulary, "contains" means these values are present, in any order; extra
fields and items are allowed. It compiles to nested `expect.objectContaining` and
`expect.arrayContaining` matchers. The "exactly" sentence compiles to `toEqual`.

| Command                                                                  | Reads                                                  | Writes or reports                                                                                                                                                                                                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `feature file draft <specification.md> [--output <candidate.feature>]`   | Reviewed Markdown and packaged Feature authoring skill | Prints a self-contained agent prompt to stdout. `--output` suggests a destination to the agent; the command creates or overwrites no Feature and invokes no authoring provider.                                          |
| `feature step list`                                                      | Compiler vocabulary                                    | Lists supported sentences and argument forms. A natural-language Gherkin step is not automatically executable.                                                                                                           |
| `feature file validate <feature> --clients <module>`                     | Feature, catalog selectors, client bindings            | Reports syntax and compilation diagnostics with source locations; starts no Sandbox and writes no suite. It does not typecheck the generated suite or connect to a system. Unsupported queue or effects steps fail here. |
| `feature suite emit <feature> --clients <module> --output <spec.ts>`     | The same validated inputs                              | Writes deterministic native Playwright TypeScript, preserving Feature/Rule/Scenario nesting, Backgrounds, tags, Examples-row identity, and step order. It refuses to overwrite any existing output file.                 |
| `feature suite validate <feature> --clients <module> --output <spec.ts>` | The same inputs and generated file                     | Regenerates in memory and exits nonzero on missing output or byte-level drift. It writes nothing and does not claim equivalence for arbitrary handwritten TypeScript.                                                    |
| `npx playwright test <spec.ts>`                                          | Project Playwright configuration and suite             | Runs the tests and records Playwright/Blackbox results. Blackbox adds no second Feature runner.                                                                                                                          |
| `feature run verify <feature> --results <results.json>`                  | Accepted Feature and completed run                     | Reserved command shape. It exits unavailable until the results contract is settled; a successful Playwright process exit alone is insufficient evidence.                                                                 |

Machine-readable diagnostics remain future work; their result schema and flag
are not defined yet. A command should
exit nonzero for invalid input, drift, missing required cases, or inconclusive
evidence rather than print a green summary.

## Naming decisions

The `feature` namespace contains explicit resources, then actions: `feature
file validate`, `feature step list`, `feature suite emit`, and `feature run
verify`. This follows the familiar shape of [`gh pr create`](https://cli.github.com/manual/gh_pr_create)
and [`docker image build`](https://docs.docker.com/reference/cli/docker/image/).
`emit` names the source-to-suite artifact operation. `feature file validate` checks
the Feature source, `feature suite validate` compares the generated artifact,
and `feature run verify` evaluates a completed run.
These are separate jobs, much as [Terraform validation](https://developer.hashicorp.com/terraform/cli/commands/validate)
is separate from execution planning. The primary path is positional and
secondary inputs use named flags, following common usage in
[Buf](https://buf.build/docs/reference/cli/buf/lint/) and
[Playwright](https://playwright.dev/docs/test-cli). The
[CLI Guidelines](https://clig.dev/) recommend consistency across subcommands.

## Reserved commands

`blackbox feature file draft <specification.md>` reads a nonempty local Markdown
file and prints its content with the packaged `feature-file-authoring` skill in an
agent prompt. Pass the prompt to an agent separately, review the resulting Feature,
then validate it with project client bindings. `--output` is a suggested path in
that prompt only. `blackbox feature run verify` still fails until the Playwright
result contract is implemented.

## Current boundaries

`feature step list`, `feature file validate`, `feature suite emit`, and
`feature suite validate` are implemented. The compiler has a closed HTTP
vocabulary; natural-language queue and effects steps are rejected with
diagnostics. The emitted suite still needs normal TypeScript checking and
Playwright execution. `feature file draft` only prepares the authoring prompt;
`feature run verify` is reserved but unavailable.
