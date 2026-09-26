# Capsule evidence and maintenance

## Know which layer failed

| Layer               | Source                                                          | Required distinction                                    |
| ------------------- | --------------------------------------------------------------- | ------------------------------------------------------- |
| Packed consumer     | `e2e/bash/capsule-assets.sh`, `capsule-asset-verify.mjs`        | Fresh tarball dependency closure, not workspace imports |
| Public CLI journey  | `e2e/bash/capsule-test.sh`                                      | Real commands and assertions, not a narrated demo       |
| Runtime and cleanup | `e2e/bash/capsule-test-support.sh`                              | Exact session/PID ownership; reused viewers survive     |
| Telemetry oracle    | `e2e/bash/capsule-telemetry-proof.mjs`                          | Activity-correlated versus session-only observations    |
| CI retention        | `.github/scripts/e2e-evidence.mjs`, `.github/workflows/e2e.yml` | Test, archive, and retention must all succeed           |

Resolve paths relative to the repo root. Read only the source/helper relevant to
the failure, but inspect both the assertion and its production behavior before
changing expected output. Do not add retries, sleeps, or snapshots merely to hide
a timing or semantic failure.

## Inspect retained artifacts

The harness prints its unique `e2e/.blackbox/tmp/capsule-test.*` directory. Read that
run's `receipt.txt`; never select arbitrary latest files from an earlier run.
Cross-check its session ID against `capsule-start.json`, activity records, stop
output, and the retained experiment under `e2e/.blackbox/experiments/`.

Verify the specific assertions in the current harness, including:

- Packed consumer package-boundary verification and absence of workspace imports.
- Fixture state changes after real HTTP/Postgres/Redis interactions, not just an
  HTTP 200 or a command invocation recorded by a mock.
- Exact HTTP activity/trace relationships; Redis shared-state downstream work is
  session-observed, not falsely attached to the initiating activity.
- The missing-executable case has its expected failure status and structured
  outcome. An arbitrary command failure is not equivalent.
- Stopped-session JSON/HTML reports remain readable; the running snapshot stays
  unchanged; fixture tokens are not leaked into exported reports.
- Owned session resources, newly owned proof images, temporary packed assets,
  and started viewers are cleaned up. A reused viewer remains running.

On failure, retain the wrapper log/result, assertion output, receipt if produced,
and partial harness artifacts before considering another asset-preparation run.
If the receipt was never produced, say which stage failed; missing artifacts are
not proof of cleanup or a successful earlier stage.

CI archives hidden files and original artifact names. Inspect transport receipts
and retention output as well as test status. A green local journey cannot replace
a failed CI evidence archive or upload check.

## Verify harness edits

Cheap checks from the repository root:

```sh
bash -n e2e/bash/capsule-assets.sh e2e/bash/capsule-test.sh e2e/bash/capsule-test-support.sh
node --test e2e/bash/*.test.mjs
node --test .github/scripts/e2e-evidence.test.mjs .github/scripts/capsule-evidence.test.mjs
```

Inspect helper tests before running them and ensure glob expansion finds actual
tests. These commands check syntax and helper behavior; they do not exercise the
full real Docker journey. Follow with the skill's acceptance command for changes
to packed assets, CLI interactions, telemetry proof, or lifecycle behavior.

When changing a behavioral assertion, demonstrate that a plausible wrong outcome
is rejected: a mismatched session, missing side effect, incorrectly correlated
span, leaked token, ignored child failure, or cleanup that claims success while
leaving owned resources. Use isolated fixtures/copies and retain semantic failure
evidence. Do not mutate production resources or weaken the test's oracle.

## Recover without deleting unrelated state

Prefer graceful cancellation so existing EXIT/INT/TERM handlers can run. If a
process was killed, inspect retained ownership records before cleanup. Stop only
the identified session via the public CLI; never choose an implicit latest
session, kill all Node processes, prune Docker globally, or recursively delete
`e2e/.blackbox` to hide a failure. Asset/image cleanup helpers also mutate state:
read their ownership checks before invoking them manually.

Report any uncertain or failed cleanup as a failure, retain diagnostics, and ask
for direction when ownership cannot be established safely. Explain what cleanup
removed and which evidence remains recoverable. Update this skill when the
harness commands, receipt schema, reset scope, or ownership semantics change.
