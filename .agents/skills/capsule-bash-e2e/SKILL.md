---
name: capsule-bash-e2e
description: Run, diagnose, or maintain Blackbox's maintainer Capsule acceptance journey, including registry-consumer verification, Docker ownership, telemetry assertions, retained evidence, and cleanup. Use for demo/acceptance, demo/storyboard, or the demo CI lane, not as a substitute for package tests.
---

# Maintainer Capsule Bash E2E

The acceptance path is `pnpm run prepare:consumer` followed by `pnpm run test:demo`,
which installs the published packages into a consumer, then runs the real CLI
journey. Passing helper tests alone does not qualify this lane.

## Inspect before running

Read root `AGENTS.md`, `package.json`, `.github/workflows/e2e.yml`,
`.github/actions/registry/action.yml`, and the current
`scripts/consumer/prepare.mjs`, `demo/acceptance/capsule-test.sh`, and
`demo/acceptance/capsule-test-support.sh`. For reset/cleanup work also read
`scripts/consumer/capsule-reset.mjs`, `scripts/consumer/capsule-assets.mjs`,
and the relevant proof-image helpers under `demo/support/` before changing resource
handling.

Prerequisites: compatible Node and pinned pnpm, a frozen workspace install, a
built workspace (`pnpm build`), a running disposable registry serving the packages
at the version in `lerna.json`, Bash, jq, curl, and a reachable Docker daemon.
Check `docker info` without changing daemon settings. Registry startup and package
installation can need network access; unavailable prerequisites are blocked, not
passed. Do not substitute a global or workspace-linked CLI for the registry consumer.

**Consumer preparation is state-changing:** it installs a temporary external
consumer from the registry, installs the project's Node driver and instrumentation
there, stops previous E2E sessions, and resets E2E reports, experiments, temporary
files, instrumentation, clients, and generated driver state. It builds nothing and
packs nothing; the workspace must already be built and published to the registry.
Inspect `e2e/.blackbox/` first. Preserve wanted evidence outside that reset scope.
If existing sessions or outputs may belong to another task, obtain permission or
use an isolated checkout before running. Run only one journey per checkout; fixed
state files make concurrent runs unsafe.

## Run the intended mode

For agent/CI verification, from the repository root, with the registry already
running and packages published (see `.github/actions/registry/action.yml`):

```sh
pnpm run prepare:consumer
mkdir -p .blackbox/tmp
capsule_run_dir=$(mktemp -d .blackbox/tmp/capsule-validation.XXXXXX)
node .github/scripts/ci-evidence.mjs run --lane demo --project capsule \
  --evidence-dir "$capsule_run_dir/journey" \
  -- pnpm test:demo </dev/null
```

Redirecting stdin disables the harness's TTY-based pauses/browser opening;
`CI=true` alone does not control that behavior. Keep the outer receipt outside
`e2e/.blackbox/tmp`, which consumer preparation resets. Use yielded execution, retain
the final process exit status, and allow time for Docker startup and teardown.

For a maintainer-requested interactive walkthrough, run `pnpm run test:demo`
in a terminal with a TTY after `prepare:consumer`. It opens the viewer and waits
for Enter between steps. Do not choose interactive mode for unattended validation
or open a browser when the user asked to leave it alone. `pnpm run test:demo:storyboard`
plays the same journey narrated, and also needs `prepare:consumer` first.

## Qualify the run, not the success banner

Read [evidence and maintenance](references/evidence.md). Verify the exact session,
activity/trace identities, real fixture side effects, installed CLI behavior,
negative command behavior, reports after stop, and cleanup outcomes. The final
`Capsule journey passed` line precedes exit cleanup: only the final successful
exit and retained evidence can establish a passed run.

For harness changes, run relevant helper tests and the full journey when practical.
Apply [LLM test qualification](../repo-setup/references/test-qualification.md) to
new/changed assertions and helpers. Report helper-only validation explicitly if
Docker or safe reset permission is unavailable; do not claim acceptance success.

Return command, revision/tree identity, final exit, session ID, evidence paths,
assertion/control results, and cleanup status. Redact secrets before sharing logs.
