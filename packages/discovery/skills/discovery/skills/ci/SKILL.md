---
name: blackbox-ci
description: Inspect existing CI/CD definitions and attach a bounded Blackbox journey with explicit write permission.
---

# CI/CD router

Use [provider recipes](../../references/ci-adapters.md). Inspection and attachment
are separate operations. Existing CI is evidence, not authorization to run a job.

## Inspect

Find provider definitions, reusable workflows/templates, service containers,
build/test steps, matrices, working directories, images, caches, health checks,
fixtures, secret references, artifact retention and cleanup conditions. Follow
local references first. Ask before expanding to other repositories or remote
providers. Record unresolved expressions and selected matrix/profile explicitly.

## Attach when requested

Use the same catalog and bounded Capsule procedure as local validation. Add only
the authorized job/steps: static validation, acquire, setup, one stimulus,
bounded terminal/observation checks, retained report, then exact-Capsule cleanup.
Cleanup and artifact collection must run on failure too. Separate their results
from behavioral checks. Preserve the child's nonzero exit and original failure.

Use an isolated project/workspace per job, unique data per physical attempt, and
only approved test credentials. Do not widen runner permissions, change branch
protections, deploy, publish, mutate global secrets or trigger a pipeline under
an inspection request. Host startup hooks and package installs execute code.

## Return

Record the source-backed CI topology and proposed or applied attachment as evidence
and next actions. A generated workflow is not an executed workflow. Include
provider/version assumptions, concurrency/reset constraints and artifact limits.
