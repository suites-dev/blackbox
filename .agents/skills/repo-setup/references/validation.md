# Lint, typecheck, and test sensors

A sensor result belongs to one input tree. Record HEAD, base, changed paths,
staged/unstaged diff identity, and hashes of relevant untracked source files before
the run. Recheck afterward; concurrent relevant edits make the result stale.
Do not publish raw diffs containing secrets as evidence.

## Retain command evidence

From the repository root, create a unique run directory under `.blackbox/tmp/`
and use a different subdirectory for each command and retry:

```sh
mkdir -p .blackbox/tmp
validation_run_dir=$(mktemp -d .blackbox/tmp/agent-validation.XXXXXX)
node .github/scripts/ci-evidence.mjs run --lane lint --project workspace \
  --evidence-dir "$validation_run_dir/lint" -- pnpm lint
node .github/scripts/ci-evidence.mjs run --lane deps --project workspace \
  --evidence-dir "$validation_run_dir/deps" -- pnpm check:deps
node .github/scripts/ci-evidence.mjs run --lane typecheck --project workspace \
  --evidence-dir "$validation_run_dir/typecheck" -- pnpm typecheck
node .github/scripts/ci-evidence.mjs run --lane test --project workspace \
  --evidence-dir "$validation_run_dir/tests" -- pnpm test
```

Read each exit status, `logs/command.log`, and `run-result.json`. The wrapper
preserves command failure; it does not prove test discovery or sufficient assertions.
Record each command independently so the last exit code cannot conceal an earlier
failure. Missing evidence, a killed command, or an unavailable prerequisite is not
green. If the wrapper is absent on an older branch, retain equivalent raw command
output and disclose that limitation; do not import tooling solely to run checks.

Lint and typecheck can run concurrently when inputs are stable. Do not overlap
builds, package tests, mutations, or E2E operations that share generated state.
Use yielded/background tool execution with bounded waits and progress updates,
not an unattended watcher. After editing, rerun affected sensors; before handoff,
collect final results against the final relevant tree.

## Select the actual test lane

| Command                         | What it establishes                                                                                                                | What it does not establish                          |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `pnpm lint`                     | Source-layout rules and package ESLint checks                                                                                      | Type safety, behavior, Bash correctness             |
| `pnpm check:deps`               | Package layering, cycles, declared deps, coupling                                                                                  | Whether an import is used correctly at runtime      |
| `pnpm typecheck`                | Root TypeScript source/test compilation                                                                                            | Runtime behavior or Docker fixture correctness      |
| `pnpm test`                     | Build, then every package `test` script                                                                                            | Package integration suites or Capsule Bash E2E      |
| `pnpm test:integration`         | Build, then every package `test:integration` script (needs npm registry access, no Docker)                                         | Default package suites or Capsule Bash E2E          |
| `pnpm test:repo`                | Repository `node:test` files under `scripts/`, `scripts/consumer/`, `demo/support/`, `.github/scripts/` (run after a build)        | Security policy tests, the SUT, or Docker lanes     |
| `pnpm test:security`            | Dependency audit policy tests in `scripts/security/`                                                                               | The audit itself                                    |
| `pnpm test:sut`                 | SUT build, source maps, and every compiled `dist/**/*.test.js`                                                                     | The Compose system under Docker                     |
| `pnpm test:sandbox:docker`      | Every sandbox `*.docker.test.ts` against the local Docker engine (`pnpm test` skips them without `BLACKBOX_SANDBOX_DOCKER_TEST=1`) | Other packages' Docker behavior or Capsule Bash E2E |
| `pnpm run test:demo </dev/null` | Published CLI and Docker-backed Capsule journey                                                                                    | Independent review or all unit-test branches        |

Inspect changed packages' scripts and runner configs before selecting targeted
commands. The instrumentation packages' default Vitest configs exclude
`*.integration.test.ts` and run them from `test:integration`; other packages'
default configs include them in `test`. Filter one package's integration suite
with `pnpm --filter <package> test:integration` after a build. `node --test`
exits 0 when a glob matches nothing, so check the reported test count.
The CLI uses `packages/cli/scripts/run-tests.mjs`, compiles tests, and invokes
Node's test runner; do not send it Vitest flags. Build before targeted CLI tests
that exercise generated executable output. A filename alone does not establish
which lane discovers it.

For package skill exports, assets, or CLI composition changes, also run
`pnpm test:e2e:skills`. It packs the main package and its core dependency closure
into an isolated consumer declaring `@suites/blackbox` and `@suites/blackbox-cli`, and exercises public
exports and copy commands without Docker. The lane covers the main-owned
`blackbox` skill for all three hosts, default core contributions, optional adapter
absence, CLI-owned executable and no root-package launcher, and a standalone CLI with no Skills dependency. Package
tests alone do not prove that the portable files were included in npm archives.

`e2e/` is listed in the pnpm workspace; do not substitute its Playwright
scripts for the separate Bash CI acceptance lane. Read the Capsule skill before
running that lane because asset preparation resets local E2E state.

For native Playwright configuration, fixtures, or reporting changes, use
`pnpm test:e2e:playwright` with a disposable registry serving the candidate packages.
The consumer journey verifies live progress ordering and retains `execution.txt`,
`live-reporting.json`, and attempt attachments in `results.json`. Helper tests alone
do not establish Docker-backed execution; preserve existing E2E evidence before
consumer preparation or run the journey in an isolated checkout.
The E2E config uses fully parallel tests with two workers. Its live evidence records
acquisition start/completion times on the reporter's monotonic clock; acceptance
requires overlapping acquisition on distinct workers within a file and across files.
Worker counts alone do not establish concurrent sandbox execution.
After the original eight scenarios, the same command runs eight effects
acceptance cases against the packed consumer, then the public retention
contract from `e2e/tests/playwright-features/`. The effects cases reuse the
package-owned specs and goldens; their discovery, report, snapshots, Sandbox
records and cleanup receipt live under `e2e/test-results/effects/` in the
existing archive. The same eight cases also exercise immutable `effects.capture()`
recorders, emission matchers, assertion accounting, and later-cut isolation.
`blackbox-emissions` JSON attachments retain verdicts, capture ownership, occurrence
references and coverage. The proof checks every expected verdict, including the
intentional failures and inconclusive positive/negated assertions.

The effects lane also compares an explicitly selected HTTP observation projection
with the reviewed `request-observations.yaml` baseline through native Playwright
snapshots. The YAML preserves multiplicity and coverage; matching an open observed
cut does not prove an exact system-wide count or absence. Unknown operations and
unavailable causal order remain inconclusive. The archive retains the YAML attachment,
`effects/request-observations.expected.yaml`, and actual JSON evidence. A successful
archive requires the effects receipt, results JSON and nonempty expected YAML.
Missing or changed baselines fail with the native
`updateSnapshots: 'none'` setting; inspect a newly generated candidate before explicitly accepting it and
rerun against the fixed expectation. Do not deduplicate occurrences or declare
capture completeness to stabilize a baseline.

The effects and retention cases use real participant containers and successive
Playwright invocations. They check retained telemetry ownership and bytes,
retention across output cleanup, the default-off option, and retention write
failures. Their stable acceptance summary must match `acceptance.golden`;
changing a golden never replaces its semantic assertions or negative controls.
Evidence under `e2e/test-results/features/` includes the golden actual/expected/diff,
per-invocation reports and logs, retained artifacts, and cleanup receipts. The
existing Playwright evidence archive preserves this directory on success or failure.
Keep consumer journeys explicit in their `.spec.ts` files. E2E inherits the
repository ESLint configuration. Playwright spec files replace the general file
and function line limits with an 80 code-token-line executable-function limit.
Only direct, synchronous last-argument callbacks to native `test.describe` and
its supported `only`, `skip`, `fixme`, `parallel`, `serial`, `parallel.only`, and
`serial.only` variants are exempt
as declaration containers;
nested tests, hooks, steps, helpers, async callbacks, and unrelated describes
remain limited.

Run `pnpm --dir e2e run test:lint` to verify the local rule and
`pnpm --dir e2e run lint` for consumer test/config/reporter/lint sources. Keep
both separate from the repository's `pnpm lint`; CI runs all three as separate
named steps in the lint job.
The same packed-consumer command also runs assertion accounting against an owned
loopback HTTP fixture with the explicitly pinned Playwright 1.64.1 runner. Its six
native cases must report three passes and three intentional failures: empty,
swallowed, and soft assertions. The outer proof checks public scope accounting,
matching rejection diagnostics, asynchronous polling, isolated concurrent scopes,
real requests, and listener cleanup; a nonzero child exit alone is insufficient.
Reports and `assertions/receipt.json`, `run-result.json`, and `cleanup.json` are
retained under `e2e/test-results/` in the existing archive. Missing assertion
evidence fails successful evidence collection.

The same packed-consumer command runs the lifecycle lane against the subscription
system and PostgreSQL. It discovers four cases: a user-facing subscription scenario,
checkpoint/diff and a reviewed state snapshot, a rejected precondition with zero
action calls, and an intentional capture-failure attempt. The user scenario checks
that the active subscription returned by the API is exactly the row retained in
PostgreSQL, then compares the final rows with a reviewed native text snapshot.
Its Rule, Scenario, and verification steps describe the accepted behavior without
adding an interaction requirement. The outer proof checks exact native statuses and the
capture-specific teardown error, distinct sandbox identities, actual cleanup
records and absence of owned Docker resources. The archive retains lifecycle
discovery, execution, results, receipt, and the fixed expected snapshot. A missing
or empty artifact fails successful evidence collection. The lane proves
subscription state, not payment-intent persistence. The complete journey owns
24 sandboxes: eight original scenarios, eight effects cases, four retention
invocations, and four lifecycle cases; assertion-accounting cases use a loopback
fixture instead of Sandbox.

The technical checkpoint case also awaits a stimulus-owned lazy HTTP emission
matcher against the real payment service. Its proof resolves repeated `effects.json`
attachments by their byte-derived digests: the automatic initial cut stays separate
from the terminal assertion cut, and the claim links the terminal cut and assertion
artifact. It checks activity ownership, witnessed observations, retained byte counts,
and reopened history. This consumer lane establishes installed-package integration;
deterministically delayed telemetry is covered by the native controlled-collector
tests under `packages/playwright/src/testing/assertion-accounting/lazy/`.
Those tests gate export after the first empty matcher read, reject another stimulus's
telemetry, and verify cancellation without a fabricated terminal artifact. Keep
open coverage explicit; a timeout with admitted incomplete cuts is inconclusive.

The console uses Playwright's native list reporter. Verify ready/cleanup messages
in each attempt's captured stdout, no streamed container polling, and retained
`blackbox-diagnostics` attachments. Lifecycle messages can be disabled using the
Blackbox reporter's `sandboxLifecycle` option without suppressing test stdout.

For documentation-only changes, check formatting, relative links, and operational
commands against source/help. Do not run root `pnpm format` as a targeted formatter:
it rewrites unrelated package files. No product test run is implied by docs checks.

If manifests, runner discovery, workflow commands, or evidence formats change,
update these instructions in the same task. Record unavailable lanes explicitly.
