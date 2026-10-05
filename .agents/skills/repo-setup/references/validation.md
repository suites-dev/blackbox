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

| Command                         | What it establishes                                                                                                         | What it does not establish                      |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `pnpm lint`                     | Source-layout rules and package ESLint checks                                                                               | Type safety, behavior, Bash correctness         |
| `pnpm check:deps`               | Package layering, cycles, declared deps, coupling                                                                           | Whether an import is used correctly at runtime  |
| `pnpm typecheck`                | Root TypeScript source/test compilation                                                                                     | Runtime behavior or Docker fixture correctness  |
| `pnpm test`                     | Build, then every package `test` script                                                                                     | Package integration suites or Capsule Bash E2E  |
| `pnpm test:integration`         | Build, then every package `test:integration` script (needs npm registry access, no Docker)                                  | Default package suites or Capsule Bash E2E      |
| `pnpm test:repo`                | Repository `node:test` files under `scripts/`, `scripts/consumer/`, `demo/support/`, `.github/scripts/` (run after a build) | Security policy tests, the SUT, or Docker lanes |
| `pnpm test:security`            | Dependency audit policy tests in `scripts/security/`                                                                        | The audit itself                                |
| `pnpm test:sut`                 | SUT build, source maps, and every compiled `dist/**/*.test.js`                                                              | The Compose system under Docker                 |
| `pnpm run test:demo </dev/null` | Published CLI and Docker-backed Capsule journey                                                                             | Independent review or all unit-test branches    |

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

Effects engine behavior is covered by `packages/effects` tests. Matcher behavior,
real PostgreSQL/RabbitMQ fixtures, and assertion goldens belong to
`packages/playwright/tests/effects`. Build dependencies with
`pnpm --filter @suites/blackbox-playwright... build`, then run
`pnpm --filter @suites/blackbox-playwright test:effects`. This Docker-backed lane
runs ten package integration cases and recovers its owned sandboxes before
removing its temporary project. Goldens retain the contracts, verdicts, and distinct
semantic witnesses; runtime identities and repeated copies are omitted.
Inspect snapshot diffs before accepting updates. Package resolution guards and the
standalone packed-effects consumer have been removed by user direction.

For package skill exports, assets, or CLI composition changes, also run
`pnpm test:e2e:skills`. It packs the main package and its core dependency closure
into an isolated consumer declaring `@suites/blackbox` and `@suites/blackbox-cli`, and exercises public
exports and copy commands without Docker. The lane covers the main-owned
`blackbox` skill for all three hosts, default core contributions, optional adapter
absence, CLI-owned executable and no root-package launcher, and a standalone CLI with no Skills dependency. Package
tests alone do not prove that the portable files were included in npm archives.

`e2e/` is not a pnpm workspace package; do not substitute its older Playwright
scripts for the active Bash CI acceptance lane. Read the Capsule skill before
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
The maintainer-only live recorder also observes the native `Start sandbox` and
`Clean up sandbox` steps for every physical attempt. Acceptance requires one
successful, ordered pair with native start times, durations, errors, and reporter
callback chronology. These lifecycle steps do not count as business steps.
Keep consumer journeys explicit in their `.spec.ts` files. E2E inherits the
repository ESLint configuration. Playwright spec files replace the general file
and function line limits with an 80 code-token-line executable-function limit.
Only direct, synchronous last-argument callbacks to `test.system`,
`system.sandbox`, and `sandbox.describe` are exempt as declaration containers;
nested tests, hooks, steps, helpers, async callbacks, and unrelated describes
remain limited.

Run `pnpm --dir e2e run test:lint` to verify the local rule and
`pnpm --dir e2e run lint` for consumer test/config/reporter/lint sources. Keep
both separate from the repository's `pnpm lint`; CI runs all three as separate
named steps in the lint job.
The console uses Playwright's native list reporter with step printing. Verify the
native `Start sandbox` and `Clean up sandbox` steps, no legacy Blackbox lifecycle
stdout, no streamed container polling, and retained `blackbox-diagnostics`
attachments. User and application stdout remains ordinary Playwright output.

For documentation-only changes, check formatting, relative links, and operational
commands against source/help. Do not run root `pnpm format` as a targeted formatter:
it rewrites unrelated package files. No product test run is implied by docs checks.

If manifests, runner discovery, workflow commands, or evidence formats change,
update these instructions in the same task. Record unavailable lanes explicitly.
