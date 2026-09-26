# Working in Blackbox

Blackbox opens connections, listeners, processes, and containers. A green command
is not proof that the intended behavior ran or that its resources were cleaned up.
Keep validation tied to the exact code and test cases executed.

## Start with the repository skills

- Use [repo-setup](.agents/skills/repo-setup/SKILL.md) to prepare a checkout or
  validate implementation changes. It includes lint/typecheck sensors, CI listening,
  and LLM test qualification. Read only the references needed for the task.
- Use [capsule-bash-e2e](.agents/skills/capsule-bash-e2e/SKILL.md) when maintaining,
  running, or diagnosing the maintainer Capsule Bash acceptance journey.

Before changing files, inspect branch, HEAD, staged/unstaged changes, and untracked
files. Preserve unrelated work and staging. Do not stash, pop, reset, clean, or
switch branches merely to simplify setup. A policy-only branch may have no runnable
workspace; report that limitation instead of importing application code.

## pnpm, Lerna, and Git flow

Use the checked-out `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`,
`lerna.json`, and workflows as the executable tooling contract. Use pinned pnpm,
`pnpm install --frozen-lockfile`, and `pnpm exec` for local tools. Do not introduce
another workspace package manager, update dependencies, or rewrite the lockfile as
a setup workaround. Standalone fixture lockfiles are separate from the workspace.

pnpm installs, builds, and tests; Lerna coordinates fixed release versions. Ordinary
PRs do not run `lerna version` or `lerna publish`. Release preparation belongs on
`prepare-release/**` targeting the matching `release/**`; verify `allowBranch` and
disabled automatic pushing in `lerna.json`. Packages marked private stay private.
Tagging, publishing, and protection changes require explicit task authorization.

Follow [the release flow](maintainers/docs/releasing.md), the linked issue's phase,
and the actual PR base. `main` is the development integration branch; alpha phases
0–6 target `release/v0.0.1-alpha`. Do not silently retarget a PR or invent a
`develop` branch. Resolve policy/configuration disagreement explicitly; older
release prose may describe tooling as planned even when this checkout has it.
Use focused branches and Conventional Commits. Protected branches change through
PRs; previous bootstrap bypasses or `[skip ci]` exceptions are not standing permission.

## Validation sensors

For code/tooling changes, establish a baseline when practical, then rerun affected
checks after each coherent edit batch. Finish with `pnpm lint`, `pnpm typecheck`,
and the relevant test lanes; use `pnpm test` for workspace package validation.
Documentation-only changes need formatting, link, and command-accuracy checks,
not an unrelated Docker run. Never describe unrun lanes as passing.

Follow [validation and evidence](.agents/skills/repo-setup/references/validation.md).
Treat sensor states as **pass, fail, blocked, or stale**. Record exact commands,
revision/tree identity, exit status, logs, and test discovery. Relevant edits
invalidate earlier evidence. Do not hide errors with `|| true`, weaker assertions,
new skips, relaxed thresholds, or a stale build. Separate pre-existing failures
from task regressions without treating either as a pass.

## Qualify tests with an LLM judge

Every added or behaviorally changed test, shared fixture/helper, discovery config,
or assertion needs [test qualification](.agents/skills/repo-setup/references/test-qualification.md).
Map tests to requirements; prove discovery and execution; challenge the oracle
with a plausible wrong implementation or negative control. Inspect removed tests,
changed skips, snapshots, mocks, and decreased counts for coverage drift.
Coverage percentages and successful process exits do not establish qualification.

Record **qualified, rejected, or inconclusive** per behavioral claim with evidence.
Local LLM self-review is provisional, not independent approval. Follow the
[PR review contract](.github/PULL_REQUEST_TEMPLATE.md): independent review is a
completed GitHub `@codex review` on the exact head SHA, not merely a request. Do not
spawn review subagents or substitute separate local/Cloud review tasks. Requesting
an external review must be within the user's authorized PR workflow. If it is
unavailable, report the missing gate; do not invent a verdict.

## Listen to CI before declaring readiness

For an authorized PR delivery/monitoring task, use the
[CI listener](.agents/skills/repo-setup/references/ci-listener.md). Inspect all
applicable jobs and live required checks on the current PR revision, including
separate E2E and security gates. A prior green SHA, missing check, pending run,
unexpected skip, cancellation, or inaccessible result is not success. Keep the
user informed while waiting. Do not merge, rerun workflows, or weaken checks just
because monitoring is authorized.

## Security and handoff

Apply [SECURITY.md](SECURITY.md) to changed boundaries. Test rejected inputs,
ownership, loopback/default exposure, secret redaction, cancellation, and cleanup
where relevant. Use disposable local fixtures, never unapproved external targets.
Do not claim that scanners eliminate all vulnerabilities or that an unconnected
provider is active.

Report changed files, exact validation outcomes, qualification evidence, and any
remaining CI/review gates. Stage only task-owned files if committing is requested;
inspect the index first and verify status afterward. Leave unrelated files alone.
