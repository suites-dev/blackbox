---
name: repo-setup
description: Prepare the Blackbox pnpm/Lerna checkout and validate implementation changes with lint/typecheck evidence, exact-revision CI monitoring, and adversarial LLM qualification of new or changed tests.
---

# Blackbox repo setup

Use from the repository root. This skill supplies an agent workflow, not an
installed background daemon or an additional enforced GitHub check.

## Establish the checkout

1. Read root `AGENTS.md`. Inspect `git status --short`, `git diff --cached --stat`,
   `git branch --show-current`, and `git rev-parse HEAD`. Identify task-owned paths
   and the intended PR base without changing either.
2. Read the current root manifest, workspace file, Lerna configuration, and relevant
   `.github/workflows/`. If this branch contains only policy documents, skip runtime
   setup and explain which validation is unavailable.
3. Check `node --version` and `pnpm --version` against engines, `packageManager`,
   and CI. Currently CI uses Node 22.x and pnpm 9.15.4. Prefer a compatible installed
   toolchain; do not silently change global tools or manifests.
4. When dependencies are needed, run `pnpm install --frozen-lockfile`. Report
   network/authentication/toolchain failures separately from source failures.
   Never fall back to an unfrozen install to force setup green.
5. Verify workspace discovery with `pnpm exec lerna list --all` when release or
   package topology is relevant. Read the installed configuration, not assumptions
   from historical release notes. Setup never versions, tags, or publishes.

## Select the workflow

- For implementation feedback, read [validation.md](references/validation.md).
  Reuse the existing command-evidence wrapper and retain current-run output.
- For added/changed tests or test infrastructure, also read
  [test-qualification.md](references/test-qualification.md) before calling them
  adequate. Include tests not yet tracked in Git.
- For an authorized PR delivery or wait task, read
  [ci-listener.md](references/ci-listener.md). Read-only inspection does not authorize
  posting comments, dispatching workflows, or merging.
- For the full Docker-backed acceptance journey, read the sibling
  [capsule-bash-e2e skill](../capsule-bash-e2e/SKILL.md).

Return a short setup/validation receipt: revision and dirty-tree identity,
tool versions, commands and outcomes, evidence paths, test-qualification status,
and any unavailable prerequisites or outstanding remote gates. Keep credentials,
private traces, and unrelated local changes out of published evidence.
