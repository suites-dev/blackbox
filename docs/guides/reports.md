# Follow the expectation into the report

A report should help a developer answer **what ran, what was checked, what differed, and what remains
unknown**. The agent uses that same execution evidence to investigate and repair.

## Capsule: understand the experiment

Use the actual session ID returned by startup. A Capsule records commands, activity identities,
outputs, runtime observations and their limitations. It does not currently execute a Feature file
or automatically approve observations as expected behavior.

```sh
pnpm exec blackbox capsule show <session-id>
pnpm exec blackbox capsule down <session-id>
pnpm exec blackbox capsule report serve --session <session-id> --open
```

A report while the Capsule is running is provisional. Stopping and draining the collector does not
prove that every library was instrumented. Preserve unknown causality and incomplete capture rather
than interpreting absent spans as absent behavior.

[Report semantics and limitations](../../packages/capsule/skills/capsule/references/evidence-and-reports.md).

## Playwright: inspect the fresh verification attempt

In the candidate product-cache workspace, after its prerequisites are available:

```sh
# From e2e/product-cache/
pnpm --dir .. exec playwright show-report product-cache/playwright-report
```

Follow the Feature/Rule/Scenario names into the native steps. The documented native suite attaches
`product-state` and `retrieval-observations`; Blackbox adds attempt and lifecycle diagnostics.
An earlier failed assertion may prevent later checks from running. Those later checks did not pass.

The Capsule experiment and the Playwright attempt are different executions. Preserve a failed
Playwright report before another invocation overwrites it; retained Sandbox artifacts do not
implicitly archive the HTML report. [Repair walkthrough](repair-from-evidence.md).

## Planned effects comparison view

This is the information the snapshot feature should expose, **not a screenshot of shipped UI**:

```text
Reviewed scenario + baseline identity
  Output assertions       expected versus returned
  State assertions        expected versus stored
  Effects comparison      accepted versus observed interactions
  Observation limits      scope, completion, missing data
  Attempt                  revision, selected system, run identity
```

An effects comparison must remain distinguishable from a response assertion and from an observer
failure. A missing baseline, opted-out comparison, or incomplete observation should be visible,
not displayed as a successful match. Actual section names and snapshot integration are not settled.

Real screenshots should come from reproducible runs once that report exists. No illustrative
checkmark or fabricated trace should stand in for execution evidence.

[Snapshot review](../contracts/reviewing-changes.md) · [Evidence](../concepts/behavioral-evidence.md)
