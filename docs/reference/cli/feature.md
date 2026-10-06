# Feature commands

The incoming Gherkin preview contributes commands to the `blackbox` CLI. They are not part of the original #159 runtime tree. See the [availability map](../../status.md) for the audited revisions and intended naming.

Every preview command accepts `--config <path>`, defaulting to `blackbox.feature.yaml`. Feature inputs come from that file's `features` globs; there is no audited per-command `--file` flag.

## `feature compile`

```sh
blackbox feature compile --config blackbox.feature.yaml
```

Parse accepted Features, resolve their system and profile selections, validate supported steps and arguments, and emit native tests with `compile-manifest.json` into the ignored output directory. Output is all-or-none. The command reports scenario requirements and barrier deadlines.

Compilation is not system execution. A syntax error should fail before acquiring a Sandbox. Regenerate instead of editing emitted tests.

## `feature check`

```sh
blackbox feature check --config blackbox.feature.yaml
```

Audit restrictions on the executable specification project: project step definitions, disallowed BDD/runtime imports, step-library forks or patches, and tracked generated output. This is **not** the generated-suite drift check or a test runner.

The preview's local-tarball exception is restricted to a pack of the package at the audited release; it is not permission to supply an arbitrary fork.

## `feature check-change`

```sh
blackbox feature check-change --config blackbox.feature.yaml --base <review-base>
```

Classify the change relative to the identified base and reject a mixed spec/code change under the project policy. The Feature project file declares additional spec and neutral paths. With the verification integration, the policy baseline is also part of the protected specification.

This is change classification, not a proof that the new specification is correct. Use the actual review base, not a convenient ref that hides changed paths.

## `feature verify`

```sh
blackbox feature verify --config blackbox.feature.yaml
```

**Incoming #165. Run after Playwright.** It compares the completed run with the compilation and protected policy: each compiled scenario must run once with a supported verdict; no uncompiled test may appear; requirement IDs must match; features, generated tests, and step-library identity must still match; and runner policy must agree with its baseline.

A missing or stale manifest is not a success. This command does not compute semantic requirement coverage. Preserve both the Playwright exit and verifier exit in CI.

## `feature steps`

```sh
blackbox feature steps --config blackbox.feature.yaml
```

List the shared library with an example sentence per step. A listed gated step may still be unavailable; required capabilities must be offered by the runtime. See [vocabulary](../feature-vocabulary.md).

## Exit status and proposed verbs

The preview commands exit `1` on failed checks and `2` when the project file is missing or invalid. Inspect diagnostics rather than treating all failures as an assertion mismatch.

The proposed `feature validate --file ...` and `feature suite emit --file ...` split the user-facing stages. They are not implemented aliases here. `compile` is the audited operation that currently combines validation and emission.

## Source contract

[Core commands](https://github.com/suites-dev/blackbox/blob/f52ef2adf561e3222bb0c298abc4835e3c9b8c18/packages/gherkin/README.md). [Post-run verification](https://github.com/suites-dev/blackbox/blob/88a73744311e0a70d3ac5451c03a2f2e3ba436c6/packages/gherkin/README.md).

---

[Documentation](../../README.md)
