# Validate a Feature

Validation establishes that a Feature has a supported executable interpretation. It does not establish that its expectation is correct or that the application satisfies it.

## Two reviews

Human/domain review asks whether the scenario says what the software should do. Compiler validation asks whether Blackbox can execute those steps for the selected system and profile. Both matter; neither substitutes for a fresh run.

The proposed single-file command is:

```sh
blackbox feature validate --file feature.feature
```

In the incoming source preview, validation occurs during compilation:

```sh
blackbox feature steps --config blackbox.feature.yaml
blackbox feature compile --config blackbox.feature.yaml
```

Compilation also writes generated artifacts, so it is not a validate-only alias. See [availability](../status.md).

## What gets checked

The compiler checks the allowed tags, system and profile references, step resolution, argument shape, required capabilities, JSON values, JSON Pointers, same-origin request paths, and the permitted deadlines. Undefined or ambiguous steps fail at their Feature location. A scenario without a claim also fails.

A named inspection credential must exist in the selected profile. Features refer to environment variable names through project configuration, never to secret values.

## Read failures at the source

When a step fails to resolve, change the authored Feature to a supported expression only if the meaning stays the same. Otherwise report the capability gap. Do not invent a step definition, patch the shared library, or turn an unsupported assertion into a comment.

A capability-gated effects step means this runtime cannot execute that claim. It does not mean the effect did not happen. An invalid JSON Pointer means the test description is invalid, not that the resource is absent.

## Independent project checks

```sh
blackbox feature check --config blackbox.feature.yaml
```

This audits project restrictions such as local step libraries and tracked generated output. It is not the semantic spec review or the completed-run verification.

Next: [Emit the suite](emit-playwright.md) · [CLI reference](../reference/cli/feature.md).

## Source contract

[Compiler and CLI](https://github.com/suites-dev/blackbox/blob/f52ef2adf561e3222bb0c298abc4835e3c9b8c18/packages/gherkin/README.md).

---

[Documentation](../README.md)
