# CLI reference

`@suites/blackbox-cli` owns the `blackbox` executable. Feature packages contribute commands to this single host. The CLI discovers the consumer's declared dependencies and development dependencies, then follows explicit module contributions.

A package merely present transitively in `node_modules` does not activate itself. Declare the CLI directly so your package manager exposes the executable; do not rely on transitive binary hoisting.

## Command families

| Family | Reference | Availability in the audit |
| --- | --- | --- |
| `onboarding` | [Onboarding](onboarding.md) | Proposed facade |
| `spec` | [Specification drafting](spec.md) | Proposed facade |
| `feature` | [Feature commands](feature.md) | Incoming Gherkin preview |
| `capsule` | [Capsule](capsule.md) | Source implementation |
| `catalog` | [Catalog](catalog.md) | Source implementation |
| `driver` | [Driver installation](driver.md) | Node authoring runtime |
| `inst` | [Instrumentation](instrumentation.md) | Node provider |
| `skills` | [Skills](skills.md) | Source implementation |

## Inspect the installed composition

```sh
blackbox --help
blackbox skills list --json
blackbox catalog --help
blackbox capsule --help
```

A missing command can mean its contributor is absent or unselected. Check compatible installed packages before inventing an alternative spelling. Use the project's package-manager launcher, such as `pnpm exec blackbox`, when the binary is not on the shell's PATH.

## Automation

Prefer structured output where the command offers `--json`. Keep stdout, stderr, CLI exit status, delegated process exit, and the report's claim result separate. Do not infer a successful operation by grepping for a checkmark.

For Capsule actions, always pass an explicit session identity once acquired. Preserve unexpected, malformed, or missing records as failures to inspect; do not substitute a “latest” result.

The host is a composition mechanism, not a sandbox for untrusted plugins. Selected modules execute project-trusted code with the host's privileges.

## Source contract

[Implementation](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/cli/README.md).

---

[Documentation](../../README.md)
