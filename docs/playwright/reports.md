# Playwright reports

Playwright owns native test progress, steps, failures, and the final terminal/HTML summary. Blackbox attaches the environment and evidence context to the relevant test attempt.

## Configure both reporters

```ts
reporter: [
  ['list', { printSteps: true }],
  ['@suites/blackbox-playwright/reporter', { sandboxLifecycle: true }],
  ['html', { open: 'never' }],
]
```

This is a fragment for the [Blackbox Playwright config](../getting-started/first-verification.md). The baseline reporter can show Sandbox-ready and cleanup messages through captured test output. Lifecycle messages are not additional business assertions.

```sh
npx playwright show-report
```

## Read one attempt

Confirm the system and Sandbox group, the scenario that actually executed, and the failing assertion or step. Then inspect its lifecycle, attempt identity, diagnostics, and available evidence attachments.

At the audited baseline, retained attachments include `blackbox-progress`, `blackbox-attempt`, and `blackbox-diagnostics`. Their producer and schema matter; do not infer an effect verdict from a span count. Incoming effects reporting is a separate surface and must be described for the actual installed version.

## Terminal versus HTML

The terminal is useful for current progress and the summary. HTML is useful for navigating steps and retained attachments. The agent should inspect the underlying structured results when it needs exact identity or capture limitations.

Do not invent a line such as “Observed 2 ✓” unless the actual reporter emitted it and its meaning is documented. A checkmark belongs to a particular executed assertion, not to the whole application's correctness.

## Policy evidence

Incoming guardrails can write a run manifest and effective runner-policy file. Preserve those alongside the report. Replacing configured reporters with a CLI `--reporter` option can remove reporter checks; the incoming Gherkin verification lane checks for the required fresh manifests rather than trusting old ones.

## Screenshots

Use [real-run captures](../assets/screenshots/README.md), including the source revision and report identity. No mock dashboard or generated test result is evidence. The report remains usable without a screenshot embedded in this page.

## Source contract

[Implementation](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/playwright/README.md). [Guardrails](https://github.com/suites-dev/blackbox/pull/155).

---

[Documentation](../README.md)
