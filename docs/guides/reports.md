# Read a failed test report

Find the failed attempt, identify which phase failed, and inspect the values that
support or contradict the expected behavior. An assertion that never ran did not pass.

## Open a Playwright report

From a project configured with the HTML reporter:

```sh
npx playwright show-report
```

For a custom output directory, pass that directory to `show-report`. Open the test
and its named steps, then inspect these Blackbox attachments:

| Attachment             | Use                                                  |
| ---------------------- | ---------------------------------------------------- |
| `blackbox-progress`    | Lifecycle events for the physical attempt.           |
| `blackbox-attempt`     | Attempt identity and its final lifecycle record.     |
| `blackbox-diagnostics` | Readable diagnostics added by the Blackbox reporter. |

Application-specific attachments exist only if your tests add them. The product-cache
case study's `product-state` and `retrieval-observations` are not built-in attachments.

## Locate the failing phase

| Failure                 | What to inspect                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------- |
| Acquisition             | Docker, Compose files, image builds, and selected services.                            |
| Activation or readiness | Instrumentation configuration, application startup, health endpoint, and deadline.     |
| Test assertion          | Expected and actual values, preconditions, and the observation used by that assertion. |
| Cleanup or retention    | Reported resource or write failure; a passing business assertion does not erase it.    |

A retry creates another Sandbox and another attempt. Inspect earlier failures as
well as the final outcome. A raw span can explain a failure, but a missing span
may mean incomplete instrumentation rather than absence of behavior.
[Evidence limitations](../concepts/behavioral-evidence.md).

## Preserve the failed run before retrying

Playwright replaces its default report and test output on the next invocation.
Copy the report to an unused directory before rerunning:

```sh
cp -R playwright-report playwright-report.failed
npx playwright show-report playwright-report.failed
```

Copy JSON output separately if you configured a JSON reporter. To retain Blackbox
attempt records, set `use: { blackboxRetainAttempts: true }` in the configuration.
Those records live under `.blackbox/experiments/<sandboxId>/` beside the catalog;
they do not archive the HTML report. [Retention reference](../playwright/fixtures.md#reports-and-retention).

## Inspect a Capsule experiment

From the configured application's root, use its actual session ID:

```sh
npx blackbox capsule show <session-id>
npx blackbox capsule down <session-id>
npx blackbox capsule report serve --session <session-id> --open
```

Use the project-local CLI from the application root. A running
Capsule's report is provisional. Stopping retains its records and updates cleanup
status; it does not establish complete instrumentation. Capsule report commands
read Capsule sessions, not saved Playwright attempts.

[Capsule report semantics](../../packages/capsule/skills/capsule/references/evidence-and-reports.md) ·
[Investigate with a Capsule](investigate-with-capsule.md) · [Review changes](../contracts/reviewing-changes.md)
