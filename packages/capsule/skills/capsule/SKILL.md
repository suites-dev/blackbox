---
name: capsule
description: Exercise one accepted behavior inside a bounded Capsule and retain its terminal, observation and cleanup evidence.
---

# Live Capsule validation

Read [capabilities](references/capabilities.md),
[permissions](references/permissions.md) and the
[validation sequence](diagrams/capsule-sequence.mmd).

## Procedure

1. Confirm explicit scope for code execution, local resource creation and any
   external service. Explain possible image pulls/builds, mounts, listeners and
   cleanup. Verify static preflight and a real terminal predicate first.
2. Acquire the selected entry with the installed command profile. Retain the
   returned Capsule/session ID from JSON, including any admitted failed startup.
   Never choose the newest session or rely on mutable current-Capsule state.
3. Observe supported readiness. Run migrations/seeding/reset as separate `setup`
   activities. Use unique data for each physical attempt.
4. Issue one deliberate `stimulus` through the appropriate driver. Retain actual
   activity identity, command envelope, child status and propagation outcome.
5. Run bounded `inspection` activities for the accepted terminal predicate. Use
   [async](references/async-workflows.md) for queues or delayed work. Do not repeat a
   non-idempotent stimulus to make a check pass.
6. Inspect the Capsule's observation scope as well as activity/trace scope. Check
   required observation sources independently from business completion. Preserve
   partial, unavailable and separately traced observations.
7. Export the supported report, then stop the exact Capsule in a failure-safe
   cleanup path. Inspect owned-resource release. A failed report must not skip
   cleanup, and a successful cleanup must not erase a failed experiment.
8. Link fresh records to the source revision, catalog digest, physical attempt,
   activities and business identifier. Return all stage outcomes independently.

## Return

Return execution findings and references to runner-owned raw records. Do not synthesize
successful receipts from prose. Cleanup failure can coexist with an operable
behavior; overall setup is still incomplete/failed. Leave unrelated resources and
old evidence untouched.

Read [the supported command procedure](references/capsule-experiments.md) before execution.
Use [runtime observation](references/runtime-observation.md) for capture gaps,
[evidence and reports](references/evidence-and-reports.md) for retained results,
[repair](references/troubleshooting-and-repair.md) for failures, and
[CI](references/ci.md) only for requested automation.

This skill can run independently. If Discovery delegates a task, return the
accepted boundary and predicate, exact session/activity identities, terminal and
observation findings, report location, cleanup outcome and remaining gaps. Do not
require Discovery to be installed to use Capsule.
