# Listen to the current PR's checks

Use this workflow for requested PR delivery or monitoring, not as permission to
publish local work. Resolve the repository and PR explicitly; confirm the intended
base and head before watching.

```sh
gh pr view "$pr_number" --repo "$repo_slug" \
  --json number,url,headRefOid,baseRefName,baseRefOid,statusCheckRollup,reviewDecision,mergeStateStatus
gh pr checks "$pr_number" --repo "$repo_slug" \
  --json name,state,bucket,workflow,link
gh pr checks "$pr_number" --repo "$repo_slug" --required \
  --json name,state,bucket,workflow,link
```

Set `pr_number` and `repo_slug` from the resolved task, not a copied example.
Compare all checks with applicable workflows and live branch rules/protections,
including code-scanning requirements. If live rules cannot be read, disclose that
readiness cannot be fully verified; a checked-in ruleset is not proof of deployment.

Current workflow landmarks are `CI Gate` (build/typecheck, lint, package tests),
`Capsule E2E (Testcontainers)`, `Security Gate`, and `Validate PR title`.
Inspect underlying jobs too: a successful aggregate must not hide a skipped or
failed required lane. Check scanner findings as well as successful scanner
execution. Do not assume Snyk enrollment/integration is complete from policy prose.

## Watch, then revalidate identity

```sh
gh pr checks "$pr_number" --repo "$repo_slug" --required \
  --watch --interval 10 --fail-fast
```

Run the watch through a yielded tool session. Recheck PR identity and all checks
periodically, including after the watch exits; give updates during long waits.
Pending (`gh pr checks` exit 8), missing expected checks, cancellations, and
unexpected skips are not success. A documented event-specific exclusion can be
not-applicable, but never infer that from the absence of a run. No checks found is
not green. Inspect optional checks relevant to the changed behavior as well.

Capture the PR head SHA, base SHA, run URL/attempt, and tested checkout SHA. GitHub
PR workflows may test a synthetic merge commit: verify its relationship to the
captured head/base instead of blindly requiring equality with the head SHA.
Workflow dispatch may target a different branch; its green result is not
automatically PR evidence. New head/base inputs invalidate the previous verdict.

For a failed run, inspect job output and retained artifacts, classify product,
test, or infrastructure failure, and fix only within the authorized task. Do not
rerun repeatedly until green, relax rules, or mark flaky failures as passes.
Rerunning workflows or posting a review request needs authorization within the PR
workflow. When a missing credential or external decision prevents progress,
report the exact blocker instead of claiming readiness.

Finish with the current head/base, required check outcomes and links, unresolved
findings, and exact-SHA independent review status. Stop at reporting unless merge
or promotion is separately authorized.
