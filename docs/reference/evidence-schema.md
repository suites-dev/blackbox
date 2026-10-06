# Evidence records and schemas

Blackbox retains different record families for different purposes. There is no single universal `evidence.json` document that should be guessed from a report screenshot.

## Identity and ownership

| Identity | What it identifies |
| --- | --- |
| Catalog entry | Selected runnable system or subsystem |
| Capsule/session | Interactive environment and retained investigation |
| Execution | A particular runtime execution scope |
| Activity | One admitted deliberate command within a Capsule |
| Playwright attempt | One physical test attempt, including retry coordinates |
| Trace/span | Telemetry correlation identities inside the observed execution |

Use the fields exposed by the relevant reader rather than assuming all IDs are interchangeable. A human title is not a unique execution identity. The same scenario name across retries does not identify the same evidence.

## Capsule storage

```text
.blackbox/experiments/capsule-<session-id>/
  session.json
  activities.json
  progress.json
  sandbox/
```

`session.json` records lifecycle and owned resources. `activities.json` retains admitted/completed activity outcomes. `progress.json` is the versioned progress document. Sandbox and collector storage retain their own records.

Canonical session/activity/progress/report schemas live under `packages/capsule/schema/`. Use the package's validated readers or those schemas for a consumer. Do not invent fields from the names above.

## Playwright attachments

The baseline attaches `blackbox-progress`, `blackbox-attempt`, and readable `blackbox-diagnostics` data to the native attempt. The test result, fixture lifecycle, and captured observations remain distinguishable. Startup observations may be bounded, with omitted counts recorded.

Application assertions and explicit state reads remain test behavior. A state helper's result is not automatically a typed Blackbox state-transition event.

## Gherkin compile manifest — incoming

`compile-manifest.json` records Feature and generated-file hashes, shared library identity, and scenario information: source location, selected system/profile, requirement IDs, and barrier deadlines. Generated output is ignored build output.

The incoming run manifest records execution information used by `feature verify`; the policy output records effective settings. Post-run verification must use records for the current compile and run, not stale output from a previous green execution.

## Interpret conservatively

A digest establishes content identity, not semantic correctness or authenticated provenance by itself. An empty list may mean no witnesses, unavailable data, filtering, or incomplete capture; use the reader's status and limits.

Keep null, false, missing, malformed, partial, and unavailable distinct. A report projection or an agent's explanation must not be written into retained source evidence as though a runtime producer generated it.

An injection record says what a driver prepared. Continued trace context and other observations establish their own narrower facts. Session co-membership alone is not proof that an activity caused every observed span.

## Consumer checklist

Validate the documented record version and requested identity, inspect truncation/capture limitations, retain source paths or JSON Pointers, and apply only claims the source can answer. Do not use permissive parsing that silently turns unsupported fields into empty success.

Next: [Evidence qualification](../verification/evidence-qualification.md) · [Reports](../capsules/reports.md).

## Source contract

[Capsule records](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/capsule/README.md). [Attempt attachments](https://github.com/suites-dev/blackbox/blob/9197de5de456285af16e4dcbcf722082217a3989/packages/playwright/README.md). [Compile/run verification](https://github.com/suites-dev/blackbox/blob/88a73744311e0a70d3ac5451c03a2f2e3ba436c6/packages/gherkin/README.md).

---

[Documentation](../README.md)
