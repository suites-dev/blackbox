---
name: capsule-bash-e2e
description: Run, diagnose, or maintain Blackbox's maintainer Capsule Bash E2E journey, including packed-consumer verification, Docker ownership, telemetry assertions, retained evidence, and cleanup. Use for e2e/bash or the Capsule E2E CI lane, not as a substitute for package tests.
---

# Maintainer Capsule Bash E2E

The acceptance path is `pnpm test:e2e:capsule`, which runs asset preparation then
the real CLI journey. Passing helper tests alone does not qualify this lane.

## Inspect before running

Read root `AGENTS.md`, `package.json`, `.github/workflows/e2e.yml`, and the current
`e2e/bash/capsule-assets.sh`, `capsule-test.sh`, and `capsule-test-support.sh`.
For reset/cleanup work also read `capsule-reset.mjs`, `capsule-asset-boundary.mjs`,
and the relevant proof-image helpers before changing resource handling.

Prerequisites: compatible Node and pinned pnpm, a frozen workspace install with
its backing pnpm store available, Bash, jq, curl, and a reachable Docker daemon.
Check `docker info` without changing daemon settings. Builds/images/package
installation can need network access; unavailable prerequisites are blocked, not
passed. Do not substitute a global or workspace-linked CLI for the packed consumer.

**Asset preparation is state-changing:** it builds/packs the package closure,
installs a temporary external consumer, stops previous E2E sessions, and resets
E2E reports, experiments, temporary files, instrumentation, clients, and generated
driver state. Inspect `e2e/.blackbox/` first. Preserve wanted evidence outside that
reset scope. If existing sessions or outputs may belong to another task, obtain
permission or use an isolated checkout before running. Run only one journey per
checkout; fixed state files make concurrent runs unsafe.

## Run the intended mode

For agent/CI verification, from the repository root:

```sh
mkdir -p .blackbox/tmp
capsule_run_dir=$(mktemp -d .blackbox/tmp/capsule-validation.XXXXXX)
node .github/scripts/ci-evidence.mjs run --lane e2e --project capsule \
  --evidence-dir "$capsule_run_dir/journey" \
  -- pnpm test:e2e:capsule </dev/null
```

Redirecting stdin disables the harness's TTY-based pauses/browser opening;
`CI=true` alone does not control that behavior. Keep the outer receipt outside
`e2e/.blackbox/tmp`, which asset preparation resets. Use yielded execution, retain
the final process exit status, and allow time for Docker startup and teardown.

For a maintainer-requested interactive walkthrough, run `pnpm test:e2e:capsule`
in a terminal with a TTY. It opens the viewer and waits for Enter between steps.
Do not choose interactive mode for unattended validation or open a browser when
the user asked to leave it alone.

## Qualify the run, not the success banner

Read [evidence and maintenance](references/evidence.md). Verify the exact session,
activity/trace identities, real fixture side effects, packaged module boundary,
negative command behavior, reports after stop, and cleanup outcomes. The final
`Capsule journey passed` line precedes exit cleanup: only the final successful
exit and retained evidence can establish a passed run.

For harness changes, run relevant helper tests and the full journey when practical.
Apply [LLM test qualification](../repo-setup/references/test-qualification.md) to
new/changed assertions and helpers. Report helper-only validation explicitly if
Docker or safe reset permission is unavailable; do not claim acceptance success.

Return command, revision/tree identity, final exit, session ID, evidence paths,
assertion/control results, and cleanup status. Redact secrets before sharing logs.
