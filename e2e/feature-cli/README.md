# Feature CLI journey

Run against candidate packages published to the disposable test registry:

```sh
node --test 'e2e/feature-cli/*.test.mjs'
BLACKBOX_TEST_REGISTRY=http://127.0.0.1:4874/ node e2e/feature-cli/run.mjs --repeat 2
```

The E2E workflow builds and publishes the packages once, then runs this lane in
its own runner. Each pass installs the exact Lerna version into a fresh temporary
consumer. The journey validates the two sync Features, emits suites to temporary
files, validates the pristine output, and checks overwrite and drift rejection.
Redis async vocabulary must fail validation and emission without producing a suite.

The structural comparison checks catalog selection, clients, hierarchy, tags,
expanded Examples rows, scoped Backgrounds, and ordered step titles against the
hand-authored suites. It normalizes the two existing Examples title conventions.
It does not compare business implementations.

A TypeScript AST transform empties every generated business step closure. The
temporary skeleton retains the client bindings and all declarations and steps.
Real Playwright runs all seven scenarios, acquiring seven Docker Sandboxes and
running the real client readiness checks. An intentionally nested sandbox must
fail collection before any body or acquisition runs. JSON reports, physical
Sandbox records, and Docker resource queries establish execution and cleanup.
This journey does **not** prove the Feature's business semantics.

Evidence is retained in a unique `.blackbox/tmp/ci-feature-cli/run-*` directory:
command exit records/logs, pristine and skeleton suites, structure, Playwright
reports, Sandbox artifacts, recovery receipts, and actual/expected golden text.
Only the owned temporary consumer is removed. Cleanup failures retain its path.
Existing E2E state and test results are untouched.

After reviewing a deliberate output change, capture a fresh golden with
`BLACKBOX_GOLDEN_UPDATE=1` and a single pass. Updates are refused in CI. Run twice
without update afterward to establish stability. A passing skeleton golden is a
lifecycle and reporting check, never approval of empty business assertions.
