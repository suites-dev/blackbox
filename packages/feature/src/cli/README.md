# Feature CLI

This CLI turns an optional Gherkin Feature into a native Blackbox Playwright
suite. It separates three questions: **does the Feature compile**, **does the
generated suite still match it**, and **what happened when Playwright ran it**.
Compilation and suite comparison are implemented; run verification is reserved
but unavailable until its results contract is defined.

## Proposed workflow

```sh
blackbox feature step list
blackbox feature file validate <feature> --clients <module>
blackbox feature suite emit <feature> --clients <module> --output <spec.ts>
blackbox feature suite validate <feature> --clients <module> --output <spec.ts>
npx playwright test <spec.ts>
blackbox feature run verify <feature> --results <results.json>
```

`<feature>` is the primary input and is positional. `--clients` identifies a
project-owned TypeScript registration module; `--output` identifies the generated
suite. The client module supplies names and `defineClient(...)` definitions. It
is a development-time input, not a JSON driver registry. The CLI currently recognizes directly named `export const` declarations and
reports other export forms as missing bindings. The catalog remains the authority
for Sandbox acquisition and instrumentation.

| Command                                                                  | Reads                                       | Writes or reports                                                                                                                                                                                                        |
| ------------------------------------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `feature step list`                                                      | Compiler vocabulary                         | Lists supported sentences and argument forms. A natural-language Gherkin step is not automatically executable.                                                                                                           |
| `feature file validate <feature> --clients <module>`                     | Feature, catalog selectors, client bindings | Reports syntax and compilation diagnostics with source locations; starts no Sandbox and writes no suite. It does not typecheck the generated suite or connect to a system. Unsupported queue or effects steps fail here. |
| `feature suite emit <feature> --clients <module> --output <spec.ts>`     | The same validated inputs                   | Writes deterministic native Playwright TypeScript, preserving Feature/Rule/Scenario nesting, Backgrounds, tags, Examples-row identity, and step order. It refuses to overwrite any existing output file.                 |
| `feature suite validate <feature> --clients <module> --output <spec.ts>` | The same inputs and generated file          | Regenerates in memory and exits nonzero on missing output or byte-level drift. It writes nothing and does not claim equivalence for arbitrary handwritten TypeScript.                                                    |
| `npx playwright test <spec.ts>`                                          | Project Playwright configuration and suite  | Runs the tests and records Playwright/Blackbox results. Blackbox adds no second Feature runner.                                                                                                                          |
| `feature run verify <feature> --results <results.json>`                  | Accepted Feature and completed run          | Reserved command shape. It exits unavailable until the results contract is settled; a successful Playwright process exit alone is insufficient evidence.                                                                 |

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

`blackbox feature file draft <spec> --output <feature>` is registered but exits
unavailable until an authoring provider is configured. Any future draft remains
a candidate for human review and must not silently turn proposed expectations
into accepted ones. `blackbox feature run verify` likewise fails until the
Playwright result contract is implemented.

## Current boundaries

`feature step list`, `feature file validate`, `feature suite emit`, and
`feature suite validate` are implemented. The compiler has a closed HTTP
vocabulary; natural-language queue and effects steps are rejected with
diagnostics. The emitted suite still needs normal TypeScript checking and
Playwright execution. `feature file draft` and `feature run verify` are reserved
but unavailable.
