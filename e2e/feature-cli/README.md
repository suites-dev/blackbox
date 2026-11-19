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

Real Playwright executes every generated business callback unchanged: all seven
scenarios, Feature and Rule Backgrounds, HTTP requests, and response and final-state
assertions. A separate inert transform serves structural comparison only. The
runnable suite receives one configuration-only change: the fixture token environment
is included explicitly in its complete `blackbox` option. Callback AST fingerprints
must match pristine generated source before execution. The reporter retains actual
HTTP and matcher events inside business steps, independently of client readiness.

A separate invocation executes the same generated repeated-refund scenario against
an owned disposable SUT variant. This fault retains the independent duplicate marker
but drops the successful refund write. The first POST still returns 201 and the
repeat returns 409; the unchanged final-state assertion must fail because the refund
is absent. The runner rejects collection, startup, transport, earlier assertion,
skip, retry, and empty-execution failures as substitutes for that intended failure.
The original SUT, generated expectations, and positive Catalog remain unchanged.

Each positive scenario owns a distinct Sandbox; the negative invocation owns one
additional failed attempt. Reports, Sandbox records, Docker queries, recovery
receipts, and deletion of the unique fault image establish cleanup. A separate
missing-selection probe still fails before its test body or acquisition runs.

Evidence is retained in a unique `.blackbox/tmp/ci-feature-cli/run-*` directory:
command exit records/logs, pristine and runnable suites, callback fingerprints,
structure, Playwright reports, HTTP and matcher events, Sandbox artifacts, mutation
source/diff and hashes, recovery/image cleanup receipts, and actual/expected golden text.
Only the owned temporary consumer is removed. Cleanup failures retain its path.
Existing E2E state and test results are untouched.

After reviewing a deliberate output change, capture a fresh golden with
`BLACKBOX_GOLDEN_UPDATE=1` and a single pass. Updates are refused in CI. Run twice
without update afterward to establish stability. The golden accompanies semantic assertions and the deliberate failed-persistence
control; updating it never replaces those checks.
